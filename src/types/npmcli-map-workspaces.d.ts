/**
 * Minimal type declarations for `@npmcli/map-workspaces`, which ships without
 * its own typings. Only the API used by Elevate is declared.
 */
declare module '@npmcli/map-workspaces' {
  interface MapWorkspacesOptions {
    /** Directory containing the root package.json. */
    cwd: string;
    /** Parsed root package.json; its `workspaces` field is resolved. */
    pkg: { workspaces?: unknown };
  }

  /** Resolves workspace patterns to a map of package name → absolute path. */
  function mapWorkspaces(options: MapWorkspacesOptions): Promise<Map<string, string>>;

  export default mapWorkspaces;
}
