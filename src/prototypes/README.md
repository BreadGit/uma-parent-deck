# White spark editor comparison

The user selected C. The main app now uses its chip layout with zero or more required families,
separate goal/lineage headers, removal on each chip, and click-again-to-close behavior. These
original comparisons retain the earlier two-required constraint for reference.

Disposable, development-only UI experiment. Run Vite and open
`/?prototype=white-sparks&variant=A`. The toolbar switches between stable variants:

- A puts Required/Preferred controls on each row in one list.
- B separates Required and Preferred groups inside Target white sparks.
- C uses compact chips and a shared editor for the selected skill.

All variants keep at most two required families, required minimum stars, preferred extras at
2★+, and per-side white lineage. Sample edits stay in memory and carry across variant switches.
Nothing reads or writes the user's saved app state. The overview reflects the sample selections;
it is not a probability calculation. Parent goal contains only blue and pink controls.

The entry point is gated on `import.meta.env.DEV`; production ignores the prototype parameters.
Retain the variants until the user chooses or refines an option. Production integration of the
selected editor is separate work.
