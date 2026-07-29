// The settings panel's segmented "stop" controls — magnitude preset, detail
// level, coordinate sphere. See ui/README.md § Stop controls.

/**
 * Wire one segmented control: each button carries its value in
 * `dataset[datasetKey]`, and only a value listed in `values` reaches `apply`,
 * so a typo in the markup is inert rather than a bad state write.
 */
export function bindStopControl<T extends string>(
  buttons: Iterable<HTMLButtonElement>,
  datasetKey: string,
  values: readonly T[],
  apply: (value: T) => void,
): void {
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const raw = btn.dataset[datasetKey];
      if (raw !== undefined && (values as readonly string[]).includes(raw)) {
        apply(raw as T);
      }
    });
  }
}

/**
 * Light the stop whose value is `active`. Value-driven rather than
 * click-driven, so a keyboard shortcut or a URL restore highlights the same
 * stop a click would.
 */
export function syncStopControl(
  buttons: Iterable<HTMLButtonElement>,
  datasetKey: string,
  active: string,
): void {
  for (const btn of buttons) {
    btn.classList.toggle('on', btn.dataset[datasetKey] === active);
  }
}
