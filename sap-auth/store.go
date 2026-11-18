package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/majd/ipatool/v2/pkg/appstore"
)

// Per-request state is returned to its browser owner, never saved on the server.
type volatileKeychain struct{ values map[string][]byte }

func (k *volatileKeychain) Get(key string) ([]byte, error) {
	if value, ok := k.values[key]; ok {
		return value, nil
	}
	return nil, errors.New("not found")
}
func (k *volatileKeychain) Set(key string, value []byte) error {
	k.values[key] = append([]byte(nil), value...)
	return nil
}
func (k *volatileKeychain) Remove(key string) error { delete(k.values, key); return nil }

func storeOperation(client appstore.AppStore, payload request, keychain *volatileKeychain, jar *memoryCookieJar) response {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	if payload.Account == nil {
		return response{Error: "Store account required"}
	}
	input := payload.Account
	account := appstore.Account{Email: input.Email, PasswordToken: input.PasswordToken,
		DirectoryServicesID: input.DirectoryServicesIdentifier, StoreFront: input.Store, Pod: input.Pod}
	saved, _ := json.Marshal(account)
	_ = keychain.Set("account", saved)
	platform := appstore.PlatformIPhone
	if payload.Platform == appstore.PlatformMacOS {
		platform = appstore.PlatformMacOS
	}
	result := response{}
	var err error
	switch payload.Operation {
	case "download-info":
		var data []byte
		data, err = appstore.AssppDownloadProduct(client, ctx, account, payload.App, payload.DeviceID, payload.VersionID, platform)
		result.Plist = string(data)
	case "purchase":
		err = client.Purchase(appstore.PurchaseInput{Account: account, App: payload.App, Platform: platform})
		if errors.Is(err, appstore.ErrLicenseAlreadyExists) {
			result.AlreadyOwned = true
			err = nil
		}
	case "versions":
		var versions appstore.ListVersionsOutput
		versions, err = client.ListVersions(appstore.ListVersionsInput{Context: ctx, Account: account, App: payload.App, Platform: platform})
		result.Versions = versions.ExternalVersionIdentifiers
	case "metadata":
		var metadata appstore.GetVersionMetadataOutput
		metadata, err = client.GetVersionMetadata(appstore.GetVersionMetadataInput{Context: ctx, Account: account, App: payload.App, VersionID: payload.VersionID, Platform: platform})
		if err == nil {
			result.Metadata = map[string]string{"displayVersion": metadata.DisplayVersion, "date": metadata.ReleaseDate.UTC().Format(time.RFC3339), "dateSource": "package"}
		}
	default:
		return response{Error: "Unsupported Store operation"}
	}
	if err != nil {
		result.Error = err.Error()
		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			result.ErrorCode = "2034"
		}
		if errors.Is(err, appstore.ErrLicenseRequired) {
			result.ErrorCode = "9610"
		}
	}
	result.NativeState, _ = keychain.Get("anisette-v4")
	result.CacheState, _ = keychain.Get("kbsync-v1")
	result.Cookies = jar.exportCookies()
	if saved, e := keychain.Get("account"); e == nil {
		var corrected appstore.Account
		if json.Unmarshal(saved, &corrected) == nil && strings.TrimSpace(corrected.StoreFront) != "" {
			result.Storefront = corrected.StoreFront
			result.StoreCountry, _ = appstore.AssppStorefrontCountry(client, corrected.StoreFront)
		}
	}
	return result
}
