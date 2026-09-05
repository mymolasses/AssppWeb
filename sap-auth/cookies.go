package main

import (
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Jar.Cookies returns request cookies with scope and expiry stripped. Retain
// accepted Set-Cookie metadata in memory for the browser's subsequent requests.
type memoryCookieJar struct {
	*cookiejar.Jar
	mu      sync.Mutex
	records map[string]inputCookie
}

func (*memoryCookieJar) Save() error { return nil }

func (j *memoryCookieJar) SetCookies(origin *url.URL, cookies []*http.Cookie) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Jar.SetCookies(origin, cookies)
	if j.records == nil {
		j.records = make(map[string]inputCookie)
	}
	now := time.Now()
	for _, c := range cookies {
		path := c.Path
		if !strings.HasPrefix(path, "/") {
			path = origin.Path
			if last := strings.LastIndex(path, "/"); last > 0 {
				path = path[:last]
			} else {
				path = "/"
			}
		}
		// Ask the standard jar to validate this cookie's scope, independently of
		// its expiry/deletion, rather than exporting rejected response cookies.
		probeJar, _ := cookiejar.New(nil)
		probeCookie := *c
		probeCookie.MaxAge = 0
		probeCookie.Expires = time.Time{}
		probeCookie.Value = "scope-check"
		probeJar.SetCookies(origin, []*http.Cookie{&probeCookie})
		probeURL := *origin
		probeURL.Path = path
		probeURL.RawPath = ""
		probeURL.Scheme = "https"
		if len(probeJar.Cookies(&probeURL)) == 0 {
			continue
		}
		domain := strings.ToLower(strings.TrimPrefix(c.Domain, "."))
		if domain == "" {
			domain = strings.ToLower(origin.Hostname())
		}
		key := domain + "|" + path + "|" + c.Name
		expires := int64(0)
		if c.MaxAge > 0 {
			expires = now.Add(time.Duration(c.MaxAge) * time.Second).Unix()
		} else if !c.Expires.IsZero() {
			expires = c.Expires.Unix()
		}
		if c.MaxAge < 0 || (expires != 0 && expires <= now.Unix()) {
			delete(j.records, key)
			continue
		}
		j.records[key] = inputCookie{
			Name: c.Name, Value: c.Value, Domain: domain, Path: path,
			ExpiresAt: expires, HTTPOnly: c.HttpOnly, Secure: c.Secure,
		}
	}
}

func (j *memoryCookieJar) exportCookies() []inputCookie {
	j.mu.Lock()
	defer j.mu.Unlock()
	keys := make([]string, 0, len(j.records))
	for key := range j.records {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]inputCookie, 0, len(keys))
	for _, key := range keys {
		c := j.records[key]
		if c.ExpiresAt == 0 || c.ExpiresAt > time.Now().Unix() {
			result = append(result, c)
		}
	}
	return result
}
