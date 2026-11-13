package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAutoLogin(t *testing.T) {
	repo := setupTest()
	repo.users["david"] = &User{Username: "david"}
	protected := Authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(r.Context().Value("user").(string)))
	}))
	status := func() (AuthStatus, *httptest.ResponseRecorder) {
		rec := httptest.NewRecorder()
		GetAuthStatus().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/status", nil))
		var s AuthStatus
		_ = json.Unmarshal(rec.Body.Bytes(), &s)
		return s, rec
	}

	// 没开：没 cookie 就 401
	t.Setenv("AUTO_LOGIN_USER", "")
	t.Setenv("AUTO_LOGIN", "")
	rec := httptest.NewRecorder()
	protected.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("off: want 401, got %d", rec.Code)
	}
	if s, _ := status(); s.Authenticated || s.AutoLogin {
		t.Fatalf("off: status %+v", s)
	}

	// 指定用户：没 cookie 也当 david，并发 cookie
	t.Setenv("AUTO_LOGIN_USER", "david")
	rec = httptest.NewRecorder()
	protected.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != 200 || rec.Body.String() != "david" || len(rec.Result().Cookies()) == 0 {
		t.Fatalf("on: code %d body %q cookies %d", rec.Code, rec.Body.String(), len(rec.Result().Cookies()))
	}
	s, rec := status()
	if !s.Authenticated || !s.AutoLogin || s.RegistrationEnabled || len(rec.Result().Cookies()) == 0 {
		t.Fatalf("on: status %+v", s)
	}
	// 注册关掉
	rec = httptest.NewRecorder()
	Register().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/register", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("register with auto login: want 403, got %d", rec.Code)
	}

	// 指定的用户不存在：不生效
	t.Setenv("AUTO_LOGIN_USER", "nobody")
	if AutoLoginEnabled() {
		t.Fatal("unknown user should not enable auto login")
	}

	// AUTO_LOGIN=true：只有一个用户才生效
	t.Setenv("AUTO_LOGIN_USER", "")
	t.Setenv("AUTO_LOGIN", "true")
	for k := range repo.users {
		if k != "david" {
			delete(repo.users, k)
		}
	}
	if autoLoginUsername() != "david" {
		t.Fatalf("single user: got %q", autoLoginUsername())
	}
	repo.users["other"] = &User{Username: "other"}
	if AutoLoginEnabled() {
		t.Fatal("two users without AUTO_LOGIN_USER should not enable auto login")
	}
}
