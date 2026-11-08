# docs

Writing about the project.

- `report.md` is the project report: the two phases, the data, the architecture, the NLU and NLG, ranking, results and future work.
- `development-history.md` follows how the app changed, from the course labs to now.
- `AI_log.md` lists what generative AI was used for and how the work was split.
- `speechstate-asr-hang.md` explains the speechstate bug behind the local patch in `patches/`.
- `presentation.odp` is the course presentation, with `presentation.pdf` exported from it.

The report, the development history and the AI log each have a PDF next to them, built with pandoc and xelatex. The report keeps its layout in its own YAML header. The other two keep it on the command line, so they stay clean on GitHub:

```
pandoc docs/report.md -o docs/report.pdf --pdf-engine=xelatex

pandoc docs/AI_log.md -o docs/AI_log.pdf --pdf-engine=xelatex \
  -V geometry=margin=2cm -V fontsize=11pt -V papersize=a4 -V colorlinks=true \
  -V title-meta="AI log" -V author-meta="Andreas Bartsiokas"
```

For `development-history.md`, use the same command with its own file names and `title-meta="Development history"`.
