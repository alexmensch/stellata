// The writable view of a readonly context an owner fills in place.

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
