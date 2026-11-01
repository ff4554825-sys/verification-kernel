package verification

default allow := false

violations contains msg if {
	input.status == "fail"
	not input.override.reason
	msg := "required checks failed and no override reason is recorded"
}

violations contains msg if {
	input.status == "unknown"
	msg := "verdict is unknown; do not claim success"
}

violations contains msg if {
	input.status == "flaky"
	msg := "verdict is flaky; do not treat pass-after-retry as proof"
}

allow if {
	input.status == "pass"
}

allow if {
	input.status != "pass"
	input.override.reason
}

decision := {
	"allow": allow,
	"status": input.status,
	"violations": violations,
}
