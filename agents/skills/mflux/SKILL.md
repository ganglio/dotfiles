---
name: mflux
description: Generates and edits images locally on this Mac with mflux (MLX image models such as Z-Image and FLUX). Use whenever the user asks to generate, create, draw, render or design an image, picture, illustration, icon, wallpaper, logo or photo, to make variations of an image, to edit or restyle an existing image from a text instruction, or to upscale an image, and whenever they mention mflux, Z-Image or FLUX. Not for charts, diagrams or anything that needs exact data or exact text; draw those as code instead.
---

# Image generation with mflux

mflux runs image models on the Apple GPU through MLX. Nothing leaves the machine.

Facts about this machine, checked on 2026-11-18. Re-check anything that matters, they change:

- mflux 0.24.0, installed with `uv tool`; the commands are on the PATH (`~/.local/bin`)
- Apple M5 Pro, 48 GB of RAM
- models already downloaded: **Z-Image-Turbo** and **FLUX.2-klein-base-4B**. List what is cached with
  `ls ~/.cache/huggingface/hub | grep '^models--'`

## The default recipe

Use Z-Image-Turbo for a plain "make me an image" request: it is downloaded, fast (9 steps) and good.

```bash
mkdir -p ~/Pictures/mflux
mflux-generate-z-image-turbo \
  --prompt "<the prompt>" \
  --width 1024 --height 1024 \
  --steps 9 \
  --seed 12345 \
  --output ~/Pictures/mflux/2026-11-18-cozy-cabin.png
```

Measured here: 768x512 took about 18 s in total and peaked at 25.5 GB of memory, the first time
included. Run it in the foreground with a timeout of several minutes, and only one generation at a
time (two would not both fit in memory).

## How to handle a request

1. **Ask only what you cannot guess.** A request like "an image of a cabin by a lake" needs no
   questions. Ask when the subject is missing, or when the image has to match something (a size, an
   aspect ratio, an existing style).
2. **Write the prompt.** Z-Image-Turbo likes plain descriptive sentences in English or Chinese: the
   subject, the setting, the light, the style, the camera or medium. Keep what the user asked for,
   add detail that serves it, add nothing that changes it. If they gave an exact prompt, use it as
   it is. Put things you do not want into the positive description ("empty street"), because the
   negative prompt is ignored by this model, and `--guidance` is ignored too.
3. **Pick the size.** Width and height must be multiples of 16. Square 1024x1024, landscape 16:9
   1344x768, landscape 3:2 1216x832, portrait 9:16 768x1344, portrait 2:3 832x1216. Stay at or under
   about 1536 on the long side; use `--low-ram` if memory runs out.
4. **Pick the output path. Never rely on the default**: it is `image.png` in the current folder and
   the next run would overwrite it. Use a descriptive file name with the date:
   - the user named a place, or the image is an asset for the project being worked on: put it there
     (create the folder if needed)
   - otherwise: `~/Pictures/mflux/YYYY-MM-DD-<short-slug>.png`
5. **Pick the seed.** Choose a random one and report it, so the image can be reproduced. For
   several variants use `--seed 1 2 3` or `--auto-seeds 4`: the files get `_seed_<n>` added to the
   name.
6. **Run it**, then check that the file exists.
7. **Look at the result** if you can read images, and compare it with the request. If it is
   plainly wrong (garbled text, broken anatomy, the wrong subject), try once more with a changed
   prompt or seed and say so. Do not loop.
8. **Show it.** Open it with `open <file>` and answer in a few lines: the path, the seed, the
   model, the size. Offer a variation or an edit, not a menu.

## When the model is not downloaded

Anything other than the two cached models downloads its weights first, from several GB to tens of
GB, and the cache is already 45 GB. Say so and ask before starting a download. Prefer the cached
models unless the user asks for something they cannot do.

## Changing an existing image

- **Restyle or vary a picture** with Z-Image-Turbo: `--image <path> <strength>`. Strength is how
  much of the input image is kept: 0 keeps nothing, the default is 0.4, higher stays closer to the
  original. Measured on a photo of an apple: at 0.6 an "oil painting" prompt
  changed almost nothing, at 0.3 it became a painting that kept the layout, at 0.15 it was
  repainted more freely. So **lower the strength to change more, raise it to change less**, and
  describe the whole look you want in the prompt ("an oil painting of ..., thick brush strokes"),
  not only the change. Try a value, look, adjust once, and say which you used.
- **Edit by instruction** ("make the sky stormy", "remove the lamp"): the edit commands, such as
  `mflux-generate-flux2-edit --image-paths <path> --prompt "<instruction>"`. `--model
  flux2-klein-base-4b` is cached, but it is a base model (50 steps, `--guidance 1.5`) that mflux
  calls slower and worse at editing than the distilled variants; those are not downloaded. Say that
  and let the user choose.
- **Upscale** with `mflux-upscale-seedvr2 <path> --resolution 2x` (not downloaded).

## Reproducing and inspecting

- Every image carries its prompt, model, seed, size and steps. Read them with `mflux-info <image>`.
- To redo an image with one thing changed, repeat its settings and change only that thing. Add
  `--make-conf` to a run to write a `<output>.metadata.json` sidecar, and `-C <that file>` to run
  with it again.

## Other models and commands

`references/commands.md` has every mflux command, the default number of steps of each model, and
how to see which options a command really honours (some are ignored by some models).

## If something fails

- **Out of memory:** add `--low-ram` or `--vae-tiling`, lower the size, or use `--quantize 8`.
- **On battery:** mflux stops when the battery falls to 5%; do not raise that limit without asking.
- **"model not found" or a network error:** the model is not cached and the download could not
  start. Say which model, and do not retry in a loop.
- **A flag has no effect:** `mflux-capabilities --command <command> --format markdown` lists which
  options each command honours.
