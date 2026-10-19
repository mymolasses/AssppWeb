package main

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

func TestKBSyncUsesOnlyAccountAndDeviceIdentity(t *testing.T) {
	calls := 0
	result := kbsyncResponse(request{DeviceID: "AABBCCDDEEFF", DSID: "18446744073709551615"}, func(ctx context.Context, hardwareID []byte, dsid uint64) ([]byte, error) {
		calls++
		if hex.EncodeToString(hardwareID) != "aabbccddeeff" || dsid != ^uint64(0) {
			t.Fatal("account/device identity was changed")
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 2*time.Minute {
			t.Fatal("generation must have a two-minute deadline")
		}
		return []byte{1, 2, 3}, nil
	})
	if calls != 1 || result.KBSync != base64.StdEncoding.EncodeToString([]byte{1, 2, 3}) || result.Account != nil || result.Cookies != nil {
		t.Fatal("only the generated blob should be returned")
	}
}

func TestKBSyncRejectsInvalidIdentitiesBeforeGeneration(t *testing.T) {
	for _, payload := range []request{
		{DeviceID: "invalid", DSID: "123"},
		{DeviceID: "aabbccddeeff00", DSID: "123"},
		{DeviceID: "aabbccddeeff", DSID: "0"},
		{DeviceID: "aabbccddeeff", DSID: "-1"},
		{DeviceID: "aabbccddeeff", DSID: "18446744073709551616"},
	} {
		result := kbsyncResponse(payload, func(context.Context, []byte, uint64) ([]byte, error) {
			t.Fatal("invalid identity reached the generator")
			return nil, nil
		})
		if result.Error == "" || result.KBSync != "" {
			t.Fatal("invalid generation request was accepted")
		}
	}
}

func TestKBSyncGenerationFailuresReturnNoBlobOrDiagnostics(t *testing.T) {
	for _, generator := range []kbsyncGenerator{
		func(context.Context, []byte, uint64) ([]byte, error) { return nil, nil },
		func(context.Context, []byte, uint64) ([]byte, error) {
			return []byte{1}, errors.New("private runtime details")
		},
		func(context.Context, []byte, uint64) ([]byte, error) { return make([]byte, 512*1024+1), nil },
	} {
		result := kbsyncResponse(request{DeviceID: "aabbccddeeff", DSID: "123"}, generator)
		if result.Error != "download signature generation failed" || result.KBSync != "" {
			t.Fatal("failed generation must not publish output")
		}
	}
}
