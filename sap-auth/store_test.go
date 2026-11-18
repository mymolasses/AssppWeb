package main

import (
	"errors"
	"github.com/majd/ipatool/v2/pkg/appstore"
	"net/http/cookiejar"
	"testing"
)

type purchaseFixture struct {
	appstore.AppStore
	err error
}

func (p purchaseFixture) Purchase(appstore.PurchaseInput) error { return p.err }

func TestStorePurchaseRetainsAccountStateAndTypedFailures(t *testing.T) {
	for _, fixture := range []struct {
		err   error
		code  string
		owned bool
	}{
		{appstore.ErrLicenseAlreadyExists, "", true},
		{appstore.ErrPasswordTokenExpired, "2034", false},
		{appstore.ErrLicenseRequired, "9610", false},
		{errors.New("fixture failure"), "", false},
	} {
		jar, _ := cookiejar.New(nil)
		keys := &volatileKeychain{values: map[string][]byte{"anisette-v4": []byte("fixture-state")}}
		account := &accountResponse{Email: "fixture@example.invalid", Store: "143441", DirectoryServicesIdentifier: "1"}
		result := storeOperation(purchaseFixture{err: fixture.err}, request{Operation: "purchase", Account: account}, keys, &memoryCookieJar{Jar: jar})
		if result.AlreadyOwned != fixture.owned || result.ErrorCode != fixture.code {
			t.Fatalf("wrong purchase failure classification: %+v", result)
		}
		if string(result.NativeState) != "fixture-state" {
			t.Fatal("rotated state was discarded")
		}
		if !fixture.owned && result.Error == "" {
			t.Fatal("real failure was hidden")
		}
	}
}
