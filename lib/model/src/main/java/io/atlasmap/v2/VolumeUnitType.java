package io.atlasmap.v2;

public enum VolumeUnitType {

    CUBIC_METER("Cubic Meter"),
    LITER("Liter"),
    CUBIC_FOOT("Cubic Foot"),
    GALLON_US_FLUID("Gallon (US Fluid)");

    private final String value;

    VolumeUnitType(String v) {
        value = v;
    }

    public String value() {
        return value;
    }

    public static VolumeUnitType fromValue(String v) {
        for (VolumeUnitType c: VolumeUnitType.values()) {
            if (c.value.equals(v)) {
                return c;
            }
        }
        throw new IllegalArgumentException(v);
    }

}
