"""Python mirror of src/client/util/astronomy-constants.ts.
One definition per quantity — drift between this file and the TS
canonical is a bug. The sibling vitest module also pins these values."""


# Julian Date of the J2000.0 epoch (2000 Jan 1.5 TT). Anchor for the
# binaries.bin wire format's sep_pa_epoch_jd offset encoding.
J2000_JD = 2451545.0

# Days in a Julian year. Used by Stage 6's WDS year-of-observation → JD
# converter and downstream consumers that propagate sep+PA across epoch.
DAYS_PER_JULIAN_YEAR = 365.25
