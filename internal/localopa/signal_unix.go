//go:build !windows

package localopa

import (
	"os"
	"syscall"
)

func interrupt(p *os.Process) error { return p.Signal(syscall.SIGINT) }
