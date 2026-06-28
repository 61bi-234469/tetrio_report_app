# Third-Party Notices

This project installs the following direct Python dependencies for report
generation. Each dependency remains under its own license.

| Package | Purpose | License |
|---|---|---|
| beautifulsoup4 | HTML parsing and update helpers | MIT License |
| Jinja2 | HTML templating | BSD License |
| matplotlib | Chart rendering | Matplotlib license / Python Software Foundation style license |
| numpy | Numeric calculations | BSD-3-Clause and bundled compatible notices |
| pandas | DataFrame processing and file I/O | BSD-3-Clause License |
| pyarrow | Parquet file I/O | Apache License 2.0 |
| requests | TETRA CHANNEL API HTTP client | Apache License 2.0 |
| scikit-learn | Scaling and analysis helpers | BSD-3-Clause License |

These notices summarize the direct dependencies listed in
`src/report_builder/requirements.txt`. Transitive dependencies are installed by
`pip` as required by those packages and retain their respective upstream
licenses.
