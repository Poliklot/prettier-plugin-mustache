# OSS Corpus Checks

`prettier-plugin-mustache` includes an optional OSS corpus check for large real-world Mustache template sets.

## Sources

The corpus runner currently checks templates from:

- [`janl/mustache.js`](https://github.com/janl/mustache.js)
- [`OpenAPITools/openapi-generator`](https://github.com/OpenAPITools/openapi-generator)
- [`swagger-api/swagger-codegen`](https://github.com/swagger-api/swagger-codegen)

The OpenAPI Generator and Swagger Codegen clones use sparse checkouts focused on their template/resource directories.

## Run

```bash
npm run build
npm run corpus:oss
```

Use an existing checkout cache with:

```bash
OSS_CORPUS_ROOT=/path/to/mustache-oss-corpus npm run corpus:oss -- --no-clone
```

## Latest local run

Date: 2026-06-04

```text
Mustache OSS corpus: 6169 files, 0 skipped, 0 failures, 0 non-idempotent, 5684 changed, 485 unchanged
- mustache.js: 65 files, 0 failures, 0 non-idempotent
- openapi-generator/modules/openapi-generator/src/main/resources: 4288 files, 0 failures, 0 non-idempotent
- openapi-generator/modules/openapi-generator/src/test/resources: 9 files, 0 failures, 0 non-idempotent
- swagger-codegen/modules/swagger-codegen/src/main/resources: 1799 files, 0 failures, 0 non-idempotent
- swagger-codegen/modules/swagger-codegen/src/test/resources: 8 files, 0 failures, 0 non-idempotent
```

The OSS corpus check is intentionally separate from normal CI because it performs network clones and scans thousands of third-party files.
