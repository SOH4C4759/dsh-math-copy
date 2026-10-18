// dsh-math-copy — Host half.
//
// Deliberately empty of behaviour: copying a formula is a page concern (the TeX
// source lives in the rendered MathML annotation, and the clipboard belongs to
// the browser), so nothing here needs a route, a process, or a stored setting.
//
// The half still exists because a bundle row is a Host entry: the loader mounts
// this package in the profile, and `dsh.client` in package.json is what makes
// the web app import `./client` at boot. Without a resolvable Host export the
// row would fail before the browser half was ever considered.

/** Package name the loader mounts this row as. */
export const name = 'dsh-math-copy'

/**
 * No Host contribution.
 *
 * Kept as a real function rather than omitted: Cordis treats a module whose
 * export set carries no `apply` differently across loader versions, and an
 * explicitly empty `apply` is the shape every sibling plugin in this profile
 * already proves works.
 */
export function apply() {}
