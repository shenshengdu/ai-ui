package auth

import (
	"net/http"
	"os"
	"strings"
)

// 免登录：AUTO_LOGIN_USER=<用户名>（或 AUTO_LOGIN=true 且库里只有一个用户）时，
// 没有有效登录的请求一律当作这个用户，并发给它登录 cookie；前端不显示登录页和「登出」。
// 网站是公开的：打开的人都会用这个账户。关掉：删掉这两个环境变量重启。

// autoLoginUsername 每次请求都现查（用户删了、改名了马上生效）；没开或找不到用户 → ""
func autoLoginUsername() string {
	if users == nil {
		return ""
	}
	if name := strings.TrimSpace(os.Getenv("AUTO_LOGIN_USER")); name != "" {
		if _, err := users.GetByUsername(name); err == nil {
			return name
		}
		log.Warn("AUTO_LOGIN_USER 指定的用户不存在，免登录没生效", "user", name)
		return ""
	}
	if !parseBoolEnv("AUTO_LOGIN", false) {
		return ""
	}
	all := users.GetAll()
	if len(all) == 1 {
		return all[0].Username
	}
	log.Warn("AUTO_LOGIN=true 但用户不是正好一个，免登录没生效；请用 AUTO_LOGIN_USER 指定", "users", len(all))
	return ""
}

// AutoLoginEnabled 免登录开着没有（给 /status 用）
func AutoLoginEnabled() bool { return autoLoginUsername() != "" }

// autoLogin 给没有有效 cookie 的请求发默认账户的 cookie；返回用户名（没开 → ""）
func autoLogin(w http.ResponseWriter) string {
	name := autoLoginUsername()
	if name == "" {
		return ""
	}
	if err := issueAuthCookie(w, name); err != nil {
		log.Warn("免登录：发 cookie 失败", "error", err)
		return ""
	}
	return name
}
