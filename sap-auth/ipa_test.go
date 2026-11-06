package main

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"encoding/binary"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPrepareIPAFramesOTAWithoutChangingContents(t *testing.T) {
	file := filepath.Join(t.TempDir(), "app.ipa")
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	contents := map[string][]byte{
		"Payload/App.app/App":              bytes.Repeat([]byte("encrypted executable fixture"), 100),
		"Payload/App.app/SC_Info/App.sinf": []byte("supplied SINF data"),
		"iTunesMetadata.plist":             []byte("supplied metadata"),
	}
	for name, data := range contents {
		var raw bytes.Buffer
		compressor, _ := flate.NewWriter(&raw, flate.DefaultCompression)
		_, _ = compressor.Write(data)
		_ = compressor.Close()
		header := &zip.FileHeader{Name: name, Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(data), CompressedSize64: uint64(raw.Len()), UncompressedSize64: uint64(len(data))}
		if name == "Payload/App.app/SC_Info/App.sinf" {
			header.Method = zip.Store
			raw.Reset()
			_, _ = raw.Write(data)
			header.CompressedSize64 = uint64(len(data))
		}
		header.SetMode(0755)
		header.SetModTime(time.Date(2026, 1, 2, 3, 4, 6, 0, time.UTC))
		entry, err := w.CreateRaw(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(raw.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := zip.OpenReader(file)
	if err != nil {
		t.Fatal(err)
	}
	rawBefore := map[string][]byte{}
	for _, entry := range before.File {
		reader, _ := entry.OpenRaw()
		rawBefore[entry.Name], _ = io.ReadAll(reader)
	}
	before.Close()
	if err := prepareIPA(file); err != nil {
		t.Fatal(err)
	}
	after, err := zip.OpenReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer after.Close()
	archive, _ := os.ReadFile(file)
	if len(after.File) != len(contents) {
		t.Fatal("entry count changed")
	}
	for _, entry := range after.File {
		if entry.Method == zip.Deflate && entry.Flags&8 == 0 {
			t.Errorf("%s missing data descriptor flag", entry.Name)
		}
		reader, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || !bytes.Equal(data, contents[entry.Name]) {
			t.Fatalf("%s changed", entry.Name)
		}
		raw, _ := entry.OpenRaw()
		compressed, _ := io.ReadAll(raw)
		if !bytes.Equal(compressed, rawBefore[entry.Name]) {
			t.Fatalf("%s recompressed", entry.Name)
		}
		offset, _ := entry.DataOffset()
		if entry.Method == zip.Store && entry.Flags&8 != 0 {
			t.Fatal("stored entry has a streaming descriptor")
		}
		if entry.Method == zip.Deflate && binary.LittleEndian.Uint32(archive[offset+int64(len(compressed)):]) != 0x08074b50 {
			t.Fatal("missing descriptor bytes")
		}
		if entry.Mode().Perm() != 0755 || entry.Modified.UTC().Format("2006-01-02") != "2026-01-02" {
			t.Fatal("mode or date changed")
		}
	}
}

func TestPrepareIPAFailurePreservesOriginal(t *testing.T) {
	file := filepath.Join(t.TempDir(), "invalid.ipa")
	data := []byte("not a zip")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := prepareIPA(file); err == nil {
		t.Fatal("expected error")
	}
	actual, _ := os.ReadFile(file)
	if !bytes.Equal(actual, data) {
		t.Fatal("original changed on failure")
	}
	entries, _ := os.ReadDir(filepath.Dir(file))
	if len(entries) != 1 {
		t.Fatal("staging files leaked")
	}
	if err := prepareIPA("relative.ipa"); err == nil {
		t.Fatal("relative path accepted")
	}
}
