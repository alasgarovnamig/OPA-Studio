//go:build windows

package localopa

import "os"

func interrupt(p *os.Process) error { return p.Kill() }
