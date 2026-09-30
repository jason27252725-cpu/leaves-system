# LEAVES Module Platform v1

This folder is loaded lazily by LEAVES Core v28.10.32+.

- `modules-manifest.json` chooses the Stable/Sandbox version of each module.
- Version folders are immutable. Publish a new folder instead of overwriting an old version.
- `quotation/0.1.0` is Phase 0 foundation only. It does not calculate prices or mutate workbooks.
- Company cost data must live in Supabase / protected storage, not in this public static folder.
