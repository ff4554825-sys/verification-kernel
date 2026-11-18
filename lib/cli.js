/**
 * One entry point for the verification CLIs.
 *
 * The repo grew 28 separate `dsh-*` binaries. That is a large surface to
 * remember, document, and get wrong in a README, so `dsh-verify` dispatches:
 *
 *   dsh-verify --plan plan.json        # unchanged legacy form
 *   dsh-verify run --plan plan.json    # explicit form
 *   dsh-verify rescore --run <dir>     # was dsh-verify-rescore
 *
 * The old binary names still work; this is an addition, not a rename.
 */

/** Subcommand -> script in bin/, excluding `run`, which is this file. */
export const SUBCOMMANDS = Object.freeze({
  report: 'report.js',
  rescore: 'rescore.js',
  oracle: 'oracle.js',
  attest: 'attest.js',
  override: 'override.js',
  contract: 'contract.js',
  mutation: 'mutation.js',
});

/** Every name `dsh-verify <name>` accepts, including the implicit run. */
export function subcommandNames() {
  return ['run', ...Object.keys(SUBCOMMANDS)].sort();
}
