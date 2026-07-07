// Fullscreen triangle for the extinction prepass — no matrices.
precision highp float;

in vec2 aPosition;

void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
