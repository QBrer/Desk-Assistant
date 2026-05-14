# Learned PPT Style Guide

This guide was distilled from `assets/reference-style.pptx`.

## Observed Structure

- Deck length: 14 slides.
- Slide size: 13.33 x 7.5 in, 16:9.
- Base layout: PowerPoint "Title and Content" used throughout, but most objects are manually positioned.
- Background: plain white.
- Dominant slide purpose: research briefing, model review, and application case studies.

## Typography

- Main title: Microsoft YaHei, 36 pt, bold, black. Typical box: x 0.38 in, y 0.00-0.16 in, w about 10.7-12 in, h about 0.54-0.80 in.
- Body text: Microsoft YaHei, 16 pt for core paragraphs, with 14 pt for compact passages.
- Captions: Microsoft YaHei, 12-14 pt, black, placed directly under or above evidence figures.
- Citations: 10-12 pt, usually Times New Roman or Arial for English references; place at y about 6.86-7.23 in.
- Emphasis: bold body runs are common. Dark red `#C00000` appears for selective emphasis; use sparingly.

## Palette

- Main text: `#0F1115` or near-black.
- Secondary text: `#222222` / `#1F1F1F`.
- Section/model bar: `#0061AA` with white text and a white outline.
- White: `#FFFFFF`.
- Red emphasis: `#C00000`.
- Avoid broad gradients or decorative multicolor backgrounds.

## Layout Patterns

### Slide Chrome

- The top area uses the textured blue strip from `assets/background-template.pptx`, not a plain white rectangle. Place it at y about 0.01 in with height about 0.96 in.
- Titles sit on the blue header strip in white bold Microsoft YaHei, around 32 pt.
- Many case-study slides use a full-width deep blue bar directly under the header at y about 0.96, height about 0.48 in. Use this for named models, cases, methods, or phase headers.
- The bottom area uses a matching blue footer strip at y about 6.86, height about 0.64 in. Citations sit inside this footer in small white type.
- Do not let main tables or process boxes run into the citation zone; leave a clear bottom rhythm that matches the reference deck.

### Model Intro / Data Pipeline

- Title across top.
- Left side: dense explanatory paragraph from x 0.0, y about 1.0, width 6.3-7.0 in.
- Right side: two stacked evidence figures, usually x 6.7-7.0, width 6.0-6.7 in.
- Captions sit close to the figures, often at y 3.4-4.6 and y 6.7.

### Two Evidence Rows

- Title across top.
- Left column: two wide figures stacked at y about 1.0 and 4.2, each about 5.8 x 2.7 in.
- Right column: two explanatory text blocks aligned with those figures.
- Bottom citation in small font.

### Case Study

- Title at top.
- Full-width blue bar at x 0.0, y about 0.82, w 13.33, h 0.48; white text names the model/case.
- Main body paragraph below the bar at y 1.30-1.54, spanning nearly full width.
- One to three figures occupy y about 2.4-6.6.
- Figure captions and citation sit near bottom.

### Overview Grid

- Title at top.
- One broad intro text band near y 1.1.
- Multiple map/data images arranged in a compact grid with small labels.
- A source citation appears at the bottom edge.

## Writing Style

- Favor a claim-first sentence, followed by mechanisms, evidence, and implication.
- Name the model, dataset, institution, year, and task whenever available.
- Use quantitative language where possible: resolution, dimensions, time span, accuracy, R2, number of samples, number of agents, etc.
- Include qualitative interpretation of figures, especially when comparing model outputs.
- Keep citations visible rather than hidden in notes.
- Also write a presenter script in the PowerPoint notes area for every slide. The notes should explain what to say, how to interpret the evidence figures, and how to transition to the next slide.

## Practical Rules

- Keep the deck dense but aligned; density should come from real evidence, not clutter.
- Prefer real screenshots, maps, tables, and paper figures over recreated decorative graphics.
- Leave narrow margins: most content can start near x 0.0-0.4 and extend close to the right edge.
- Use no bullets when a compact paragraph communicates the story better; bullets are acceptable for limitation lists.
- Use blue bars only for named model/case headers.
- Avoid cover slides unless the user explicitly requests one; the reference starts directly with content.
