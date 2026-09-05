package main

import (
	"errors"
	"testing"

	"github.com/majd/ipatool/v2/pkg/appstore"
)

type stubLoginClient struct {
	calls  int
	input  appstore.LoginInput
	output appstore.LoginOutput
	err    error
}

func (s *stubLoginClient) Login(input appstore.LoginInput) (appstore.LoginOutput, error) {
	s.calls++
	s.input = input
	return s.output, s.err
}

func TestLoginDelegatesOnce(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{name: "success"},
		{name: "two factor", err: appstore.ErrAuthCodeRequired},
		{name: "credentials", err: errors.New("invalid credentials")},
		{name: "upstream retries exhausted", err: errors.New("authentication request failed after 3 attempts (HTTP 503, 503, 503)")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubLoginClient{err: tc.err, output: appstore.LoginOutput{
				Account: appstore.Account{Email: "test@example.test", PasswordToken: "test-token"},
			}}
			result, err := login(store, request{
				Email: "test@example.test", Password: "test-password", AuthCode: "123 456",
			})
			if store.calls != 1 {
				t.Fatalf("Login called %d times; ipatool owns transient retries", store.calls)
			}
			if !errors.Is(err, tc.err) {
				t.Fatalf("upstream error was not preserved: %v", err)
			}
			if store.input.Email != "test@example.test" || store.input.Password != "test-password" || store.input.AuthCode != "123456" {
				t.Fatal("login input was not forwarded correctly")
			}
			if result.Account.PasswordToken != "test-token" {
				t.Fatal("upstream account was not preserved")
			}
		})
	}
}
