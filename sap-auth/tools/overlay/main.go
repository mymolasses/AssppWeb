// Prepare a writable copy of the exactly pinned module; never modify GOMODCACHE.
package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	data, err := exec.Command("go", "list", "-m", "-json", "github.com/majd/ipatool/v2").Output()
	if err != nil {
		panic(err)
	}
	var module struct {
		Dir     string
		Version string
	}
	if err = json.Unmarshal(data, &module); err != nil {
		panic(err)
	}
	target, err := filepath.Abs(filepath.Join(".ipatool", module.Version))
	if err != nil {
		panic(err)
	}
	if _, err = os.Stat(filepath.Join(target, "go.mod")); err != nil {
		if err = os.MkdirAll(target, 0700); err != nil {
			panic(err)
		}
		if err = os.CopyFS(target, os.DirFS(module.Dir)); err != nil {
			panic(err)
		}
	}
	data, err = os.ReadFile("bridge/asspp_web.go.txt")
	if err != nil {
		panic(err)
	}
	if err = os.WriteFile(filepath.Join(target, "pkg", "appstore", "asspp_web.go"), data, 0600); err != nil {
		panic(err)
	}
	for _, name := range []string{"mod", "sum"} {
		data, err = os.ReadFile("go." + name)
		if err != nil {
			panic(err)
		}
		if err = os.WriteFile("bridge."+name, data, 0600); err != nil {
			panic(err)
		}
	}
	cmd := exec.Command("go", "mod", "edit", "-modfile=bridge.mod", "-replace=github.com/majd/ipatool/v2="+target)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err = cmd.Run(); err != nil {
		panic(err)
	}
}
