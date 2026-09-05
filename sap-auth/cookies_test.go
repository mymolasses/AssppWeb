package main

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"
	"time"
)

func TestCookieExportPreservesRedownloadAuthentication(t *testing.T) {
	base, _ := cookiejar.New(nil)
	jar := &memoryCookieJar{Jar: base}
	origin, _ := url.Parse("https://auth.itunes.apple.com/auth/v1/native/fast/")
	jar.SetCookies(origin, []*http.Cookie{
		{Name: "session", Value: "test", Domain: ".itunes.apple.com", Path: "/", Secure: true, HttpOnly: true, MaxAge: 3600},
		{Name: "auth-only", Value: "private", Path: "/"},
	})
	cookies := jar.exportCookies()
	if len(cookies) != 2 {
		t.Fatalf("expected two cookies, got %d", len(cookies))
	}
	var session inputCookie
	for _, c := range cookies {
		if c.Name == "session" {
			session = c
		}
	}
	if session.Domain != "itunes.apple.com" || session.Path != "/" || !session.Secure || !session.HTTPOnly || session.ExpiresAt <= time.Now().Unix() {
		t.Fatal("cookie metadata was lost during export")
	}
	restored, _ := cookiejar.New(nil)
	seedCookies(restored, cookies)
	dispatch, _ := url.Parse("https://downloaddispatch.itunes.apple.com/r/redownload")
	available := restored.Cookies(dispatch)
	if len(available) != 1 || available[0].Name != "session" {
		t.Fatal("redownload lost the shared session or received an auth-only cookie")
	}
}

func TestCookieExportHonorsScopeReplacementAndExpiry(t *testing.T) {
	base, _ := cookiejar.New(nil)
	jar := &memoryCookieJar{Jar: base}
	origin, _ := url.Parse("https://auth.itunes.apple.com/auth/login")
	jar.SetCookies(origin, []*http.Cookie{
		{Name: "scoped", Value: "old"},
		{Name: "reject", Value: "bad", Domain: "example.com"},
		{Name: "expired", Value: "old", Expires: time.Now().Add(-time.Hour)},
	})
	jar.SetCookies(origin, []*http.Cookie{{Name: "scoped", Value: "new"}})
	cookies := jar.exportCookies()
	if len(cookies) != 1 || cookies[0].Value != "new" || cookies[0].Path != "/auth" || cookies[0].Domain != "auth.itunes.apple.com" {
		t.Fatal("replacement, default path, or invalid cookie filtering failed")
	}
	jar.SetCookies(origin, []*http.Cookie{{Name: "scoped", MaxAge: -1}})
	if len(jar.exportCookies()) != 0 {
		t.Fatal("deleted cookie exported")
	}
	seedCookies(jar, []inputCookie{{Name: "stale", Value: "old", Domain: "itunes.apple.com", Path: "/", ExpiresAt: time.Now().Add(-time.Hour).Unix()}})
	if len(jar.exportCookies()) != 0 {
		t.Fatal("expired imported cookie revived")
	}
}
