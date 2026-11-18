package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/majd/ipatool/v2/pkg/appstore"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
)

type inputCookie struct {
	Name      string `json:"name"`
	Value     string `json:"value"`
	Path      string `json:"path"`
	Domain    string `json:"domain,omitempty"`
	ExpiresAt int64  `json:"expiresAt,omitempty"`
	HTTPOnly  bool   `json:"httpOnly"`
	Secure    bool   `json:"secure"`
}

type request struct {
	Platform        appstore.Platform `json:"platform,omitempty"`
	CacheState      []byte            `json:"cacheState,omitempty"`
	Account         *accountResponse  `json:"account,omitempty"`
	App             appstore.App      `json:"app,omitempty"`
	VersionID       string            `json:"versionId,omitempty"`
	NativeState     []byte            `json:"nativeState,omitempty"`
	PackagePath     string            `json:"packagePath,omitempty"`
	Operation       string            `json:"operation,omitempty"`
	DSID            string            `json:"dsid,omitempty"`
	Email           string            `json:"email"`
	Password        string            `json:"password"`
	AuthCode        string            `json:"authCode,omitempty"`
	DeviceID        string            `json:"deviceId"`
	ExistingCookies []inputCookie     `json:"existingCookies,omitempty"`
}

type accountResponse struct {
	StoreCountry                string        `json:"storeCountry,omitempty"`
	NativeState                 []byte        `json:"nativeState,omitempty"`
	Email                       string        `json:"email"`
	AppleID                     string        `json:"appleId"`
	Store                       string        `json:"store"`
	FirstName                   string        `json:"firstName"`
	LastName                    string        `json:"lastName"`
	PasswordToken               string        `json:"passwordToken"`
	DirectoryServicesIdentifier string        `json:"directoryServicesIdentifier"`
	Cookies                     []inputCookie `json:"cookies"`
	DeviceIdentifier            string        `json:"deviceIdentifier"`
	Pod                         string        `json:"pod,omitempty"`
}

type response struct {
	StoreCountry string            `json:"storeCountry,omitempty"`
	CacheState   []byte            `json:"cacheState,omitempty"`
	NativeState  []byte            `json:"nativeState,omitempty"`
	Plist        string            `json:"plist,omitempty"`
	ErrorCode    string            `json:"errorCode,omitempty"`
	AlreadyOwned bool              `json:"alreadyOwned,omitempty"`
	Storefront   string            `json:"storefront,omitempty"`
	Versions     []string          `json:"versions,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	Prepared     bool              `json:"prepared,omitempty"`
	KBSync       string            `json:"kbsync,omitempty"`
	Account      *accountResponse  `json:"account,omitempty"`
	Error        string            `json:"error,omitempty"`
	CodeRequired bool              `json:"codeRequired,omitempty"`
	Cookies      []inputCookie     `json:"cookies"`
}

type memoryKeychain struct{}

func (memoryKeychain) Get(string) ([]byte, error) { return nil, errors.New("not found") }
func (memoryKeychain) Set(string, []byte) error   { return nil }
func (memoryKeychain) Remove(string) error        { return nil }

type fixedMachine struct{ deviceID string }

func (m fixedMachine) MacAddress() (string, error) {
	if len(m.deviceID) != 12 {
		return "", errors.New("device ID must contain 12 hexadecimal characters")
	}
	parts := make([]string, 0, 6)
	for index := 0; index < len(m.deviceID); index += 2 {
		parts = append(parts, m.deviceID[index:index+2])
	}
	return strings.Join(parts, ":"), nil
}
func (fixedMachine) HomeDirectory() string            { return os.TempDir() }
func (fixedMachine) ReadPassword(int) ([]byte, error) { return nil, errors.New("unsupported") }

func main() {
	encoder := json.NewEncoder(os.Stdout)
	var payload request
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		_ = encoder.Encode(response{Error: "invalid request"})
		return
	}
	if payload.Operation == "kbsync" {
		_ = encoder.Encode(kbsyncResponse(payload, generateDownloadKBSync))
		return
	}
	if payload.Operation == "warmup" {
		_ = encoder.Encode(warmupRuntime())
		return
	}
	if payload.Operation == "prepare-ipa" {
		if err := prepareIPA(payload.PackagePath); err != nil {
			_ = encoder.Encode(response{Error: "IPA streaming preparation failed"})
		} else {
			_ = encoder.Encode(response{Prepared: true})
		}
		return
	}
	if payload.Operation != "" && payload.Operation != "download-info" && payload.Operation != "purchase" && payload.Operation != "versions" && payload.Operation != "metadata" {
		_ = encoder.Encode(response{Error: "unsupported helper operation"})
		return
	}

	payload.DeviceID = strings.ToLower(strings.TrimSpace(payload.DeviceID))
	if (payload.Operation == "" && (payload.Email == "" || payload.Password == "")) || len(payload.DeviceID) != 12 {
		_ = encoder.Encode(response{Error: "email, password, and a 12-character device ID are required"})
		return
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		_ = encoder.Encode(response{Error: err.Error()})
		return
	}
	cookieJar := &memoryCookieJar{Jar: jar}
	seedCookies(cookieJar, payload.ExistingCookies)

	keychain := &volatileKeychain{values: make(map[string][]byte)}
	state := payload.NativeState
	if payload.Account != nil {
		state = payload.Account.NativeState
	}
	if len(state) > 0 {
		_ = keychain.Set("anisette-v4", state)
	}
	if len(payload.CacheState) > 0 {
		_ = keychain.Set("kbsync-v1", payload.CacheState)
	}
	store := appstore.NewAppStore(appstore.Args{
		CookieJar:       cookieJar,
		OperatingSystem: operatingsystem.New(),
		Keychain:        keychain,
		Machine:         fixedMachine{deviceID: payload.DeviceID},
	})

	if payload.Operation != "" {
		_ = encoder.Encode(storeOperation(store, payload, keychain, cookieJar))
		return
	}
	result, err := login(store, payload)
	if err != nil {
		failure := authenticationFailure(err, cookieJar)
		failure.NativeState, _ = keychain.Get("anisette-v4")
		_ = encoder.Encode(failure)
		return
	}

	account := result.Account
	firstName, lastName := splitName(account.Name)
	output := accountResponse{
		Email:                       payload.Email,
		AppleID:                     account.Email,
		Store:                       account.StoreFront,
		FirstName:                   firstName,
		LastName:                    lastName,
		PasswordToken:               account.PasswordToken,
		DirectoryServicesIdentifier: account.DirectoryServicesID,
		Cookies:                     cookieJar.exportCookies(),
		DeviceIdentifier:            payload.DeviceID,
		Pod:                         account.Pod,
	}
	output.NativeState, _ = keychain.Get("anisette-v4")
	output.StoreCountry, _ = appstore.AssppStorefrontCountry(store, account.StoreFront)
	_ = encoder.Encode(response{Account: &output})
}

func authenticationFailure(err error, jar *memoryCookieJar) response {
	return response{
		Error:        err.Error(),
		CodeRequired: errors.Is(err, appstore.ErrAuthCodeRequired) || strings.Contains(err.Error(), "try a fresh 2FA code"),
		Cookies:      jar.exportCookies(),
	}
}

// ipatool retries transient HTTP 204/404/5xx authentication responses itself.
// Invoke Login once here so we do not multiply its retry budget. The frontend
// can still retry a cached session once with a fresh cookie jar.
type loginClient interface {
	Login(appstore.LoginInput) (appstore.LoginOutput, error)
}

func login(store loginClient, payload request) (appstore.LoginOutput, error) {
	return store.Login(appstore.LoginInput{
		Email:    payload.Email,
		Password: payload.Password,
		AuthCode: strings.ReplaceAll(payload.AuthCode, " ", ""),
	})
}

func seedCookies(jar http.CookieJar, cookies []inputCookie) {
	for _, cookie := range cookies {
		host := strings.TrimPrefix(cookie.Domain, ".")
		if host == "" {
			host = "buy.itunes.apple.com"
		}
		origin, err := url.Parse("https://" + host + "/")
		if err != nil {
			continue
		}
		var expires time.Time
		if cookie.ExpiresAt != 0 {
			expires = time.Unix(cookie.ExpiresAt, 0)
		}
		jar.SetCookies(origin, []*http.Cookie{{
			Name: cookie.Name, Value: cookie.Value, Path: cookie.Path,
			Domain: cookie.Domain, HttpOnly: cookie.HTTPOnly, Secure: cookie.Secure,
			Expires: expires,
		}})
	}
}

func splitName(name string) (string, string) {
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return "", ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}
