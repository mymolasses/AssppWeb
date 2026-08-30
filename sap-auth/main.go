package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/majd/ipatool/v2/pkg/appstore"
	apphttp "github.com/majd/ipatool/v2/pkg/http"
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
	Email           string        `json:"email"`
	Password        string        `json:"password"`
	AuthCode        string        `json:"authCode,omitempty"`
	DeviceID        string        `json:"deviceId"`
	ExistingCookies []inputCookie `json:"existingCookies,omitempty"`
}

type accountResponse struct {
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
	Account      *accountResponse `json:"account,omitempty"`
	Error        string           `json:"error,omitempty"`
	CodeRequired bool             `json:"codeRequired,omitempty"`
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

type memoryCookieJar struct{ *cookiejar.Jar }

func (memoryCookieJar) Save() error { return nil }

func main() {
	encoder := json.NewEncoder(os.Stdout)
	var payload request
	if err := json.NewDecoder(os.Stdin).Decode(&payload); err != nil {
		_ = encoder.Encode(response{Error: "invalid request"})
		return
	}

	payload.DeviceID = strings.ToLower(strings.TrimSpace(payload.DeviceID))
	if payload.Email == "" || payload.Password == "" || len(payload.DeviceID) != 12 {
		_ = encoder.Encode(response{Error: "email, password, and a 12-character device ID are required"})
		return
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		_ = encoder.Encode(response{Error: err.Error()})
		return
	}
	cookieJar := memoryCookieJar{Jar: jar}
	seedCookies(cookieJar, payload.ExistingCookies)

	store := appstore.NewAppStore(appstore.Args{
		CookieJar:       cookieJar,
		OperatingSystem: operatingsystem.New(),
		Keychain:        memoryKeychain{},
		Machine:         fixedMachine{deviceID: payload.DeviceID},
	})

	result, err := loginWithRetry(store, payload)
	if err != nil {
		_ = encoder.Encode(response{
			Error:        err.Error(),
			CodeRequired: errors.Is(err, appstore.ErrAuthCodeRequired),
		})
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
		Cookies:                     collectCookies(cookieJar, account.Pod),
		DeviceIdentifier:            payload.DeviceID,
		Pod:                         account.Pod,
	}
	_ = encoder.Encode(response{Account: &output})
}

const maxLoginAttempts = 3

// Apple occasionally rejects an otherwise valid SAP-signed request at the
// edge with an empty 204/301/404/503 response. These responses contain no
// account-level result and are safe to retry; credential and 2FA failures are
// returned immediately by ipatool.
func loginWithRetry(store appstore.AppStore, payload request) (appstore.LoginOutput, error) {
	input := appstore.LoginInput{
		Email:    payload.Email,
		Password: payload.Password,
		AuthCode: strings.ReplaceAll(payload.AuthCode, " ", ""),
	}

	var result appstore.LoginOutput
	var err error
	for attempt := 1; attempt <= maxLoginAttempts; attempt++ {
		result, err = store.Login(input)
		if err == nil || !isRetryableAppleEdgeError(err) || attempt == maxLoginAttempts {
			return result, err
		}
		time.Sleep(time.Duration(attempt) * time.Second)
	}

	return result, err
}

func isRetryableAppleEdgeError(err error) bool {
	message := err.Error()
	for _, status := range []string{
		"HTTP 204",
		"HTTP 301",
		"HTTP 404",
		"HTTP 503",
	} {
		if strings.Contains(message, status) {
			return true
		}
	}
	return false
}

func seedCookies(jar apphttp.CookieJar, cookies []inputCookie) {
	for _, cookie := range cookies {
		host := strings.TrimPrefix(cookie.Domain, ".")
		if host == "" {
			host = "buy.itunes.apple.com"
		}
		origin, err := url.Parse("https://" + host + "/")
		if err != nil {
			continue
		}
		jar.SetCookies(origin, []*http.Cookie{{
			Name: cookie.Name, Value: cookie.Value, Path: cookie.Path,
			Domain: cookie.Domain, HttpOnly: cookie.HTTPOnly, Secure: cookie.Secure,
		}})
	}
}

func collectCookies(jar apphttp.CookieJar, pod string) []inputCookie {
	hosts := []string{"buy.itunes.apple.com"}
	if pod != "" {
		hosts = append(hosts, fmt.Sprintf("p%s-buy.itunes.apple.com", pod))
	}
	seen := make(map[string]bool)
	result := make([]inputCookie, 0)
	for _, host := range hosts {
		origin, _ := url.Parse("https://" + host + "/")
		for _, cookie := range jar.Cookies(origin) {
			key := cookie.Name + "|" + host + "|" + cookie.Path
			if seen[key] {
				continue
			}
			seen[key] = true
			result = append(result, inputCookie{
				Name: cookie.Name, Value: cookie.Value, Path: cookie.Path,
				Domain: host, HTTPOnly: cookie.HttpOnly, Secure: cookie.Secure,
			})
		}
	}
	return result
}

func splitName(name string) (string, string) {
	parts := strings.Fields(name)
	if len(parts) == 0 {
		return "", ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}
