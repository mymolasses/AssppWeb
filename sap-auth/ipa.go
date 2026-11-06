package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/majd/ipatool/v2/pkg/appstore"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
)

// Reuse pinned ipatool's raw ZIP framing: preserve compressed bytes, modes and
// separate local/central extra fields, with data descriptors for Deflate entries.
// No authentication or network requests occur in this operation. SINF and all
// other supplied files have already been injected and verified by the backend.
func prepareIPA(packagePath string) error {
	if !filepath.IsAbs(packagePath) {
		return errors.New("absolute IPA path required")
	}
	info, err := os.Lstat(packagePath)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("regular IPA file required")
	}
	stage, err := os.CreateTemp(filepath.Dir(packagePath), ".ipa-ota-*.ipa")
	if err != nil {
		return err
	}
	stagePath := stage.Name()
	if err := stage.Close(); err != nil {
		os.Remove(stagePath)
		return err
	}
	defer os.Remove(stagePath)
	defer os.Remove(stagePath + ".tmp")
	if err := os.Remove(stagePath); err != nil {
		return err
	}
	// A staging hard link avoids another full IPA copy on the same filesystem.
	// ipatool replaces the link rather than modifying the source inode.
	if err := os.Link(packagePath, stagePath); err != nil {
		if err := copyIPA(packagePath, stagePath); err != nil {
			return err
		}
	}
	store := appstore.NewAppStore(appstore.Args{OperatingSystem: operatingsystem.New()})
	if err := store.ReplicateSinf(appstore.ReplicateSinfInput{PackagePath: stagePath}); err != nil {
		return err
	}
	return os.Rename(stagePath, packagePath)
}

func copyIPA(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	return errors.Join(copyErr, closeErr)
}
