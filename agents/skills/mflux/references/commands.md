# mflux commands (version 0.24.0)

Every command has `--help`. `mflux-capabilities --command <name> --format markdown` shows which of
its options are honoured, which are ignored by that model (for example `--negative-prompt` and
`--guidance` on Z-Image-Turbo) and which depend on a condition.

## Commands

Text to image (the model is chosen by the command, and `--model` can name another):

| command | what it is |
|---|---|
| `mflux-generate-z-image-turbo` | Z-Image Turbo, 9 steps. The default here. |
| `mflux-generate-z-image` | Z-Image base: 50 steps, uses `--guidance 4`. Slower. |
| `mflux-generate-flux2` | FLUX.2 Klein (4B / 9B). Distilled models take 4 steps, `base` models 50. |
| `mflux-generate` | FLUX.1 (`dev` 25 steps, `schnell` 4 steps). Large downloads. |
| `mflux-generate-flux3` | FLUX 3 Image Klein |
| `mflux-generate-qwen`, `mflux-generate-qwen-2.1` | Qwen Image |
| `mflux-generate-krea2` | Krea 2 (8 steps) |
| `mflux-generate-fibo`, `mflux-generate-fibo2` | FIBO, FIBO 2 |
| `mflux-generate-ernie-image`, `mflux-generate-ernie-image-turbo` | ERNIE Image (50 / 8 steps) |
| `mflux-generate-boogu`, `mflux-generate-lens`, `mflux-generate-iris`, `mflux-generate-anima`, `mflux-generate-ideogram4`, `mflux-generate-moss-image` | other models |
| `mflux-generate-ming` | RGBA output (transparent background) |

Editing and image input:

| command | what it is |
|---|---|
| `mflux-generate-flux2-edit` | edit with an instruction, `--image-paths` takes one or more images |
| `mflux-generate-flux3-edit` | the same with FLUX 3, up to 10 reference images |
| `mflux-generate-qwen-edit`, `mflux-generate-qwen-2.1-edit` | edit with Qwen |
| `mflux-generate-kontext` | FLUX.1 Kontext, `--image <path> <strength>` |
| `mflux-generate-fibo-edit`, `mflux-generate-fibo2-edit` | edit with FIBO |
| `mflux-generate-fill` | fill a masked area (inpainting) |
| `mflux-generate-redux` | variations from a reference image |
| `mflux-generate-in-context*` | in-context LoRA, editing and virtual try-on |
| `mflux-generate-controlnet`, `mflux-generate-depth`, `mflux-generate-z-image-controlnet`, `mflux-generate-qwen-2.1-controlnet`, `mflux-generate-krea2-controlnet` | guided by a control image (edges, depth, pose) |
| `mflux-upscale-seedvr2` | upscale, `--resolution 2x` or a size for the short edge |
| `mflux-upscale-controlnet` | upscale with a ControlNet |

Utilities: `mflux-info <image>` (metadata of an image), `mflux-capabilities`, `mflux-check model`
(can a model package run), `mflux-save` (save a quantized model), `mflux-lora-library`,
`mflux-train`.

## Default steps per model

The number to give `--steps` when the user does not care. Distilled and turbo models are made for
few steps; more does not help them.

| model | steps |
|---|---|
| z-image-turbo | 9 |
| z-image | 50 |
| flux2-klein-4b, flux2-klein-9b, flux2-klein-9b-kv | 4 |
| flux2-klein-base-4b, flux2-klein-base-9b | 50 (`--guidance 1.5`) |
| flux3-image-klein / flux3-image-klein-base | 16 / 50 |
| dev, krea-dev, dev-kontext, dev-fill, dev-redux, dev-depth | 25 |
| schnell | 4 |
| krea-2 | 8 |
| qwen-image, qwen-image-edit, qwen-image-edit-2511 | 20 |
| qwen-image-2.1 / qwen-image-2.1-turbo | 40 / 8 |
| ernie-image / ernie-image-turbo | 50 / 8 |
| fibo, fibo2, fibo-edit | 50 |
| fibo-lite / fibo-edit-rmbg / fibo2-edit-turbo | 8 / 10 / 4 |
| boogu-image-turbo, lens-turbo, iris-3b | 4 |
| iris-3b-base | 100 |
| ideogram-4-fp8 | 20 |
| ming-image-design | 12 |
| anima-turbo / anima-aesthetic / anima-base | 10 / 30 / 30 |
| moss-image-sft, moss-image-base | 50 |

Models not in the list use 25.

## Useful options (most commands)

| option | use |
|---|---|
| `--prompt`, `--prompt-file` | the description; a file for a long prompt |
| `--width`, `--height` | pixels, multiples of 16 (`--height`/`--width` default to the input image's size when there is one) |
| `--seed`, `--auto-seeds N` | reproducible seeds; several seeds make several images |
| `--steps`, `--guidance` | see the table; guidance only matters for non-distilled models |
| `--output` | file name; `{seed}` can be used in it |
| `--image <path> [strength]` | start from an image |
| `--lora <path-or-repo> [scale]`, `--lora-style` | LoRA adapters |
| `--quantize 3\|4\|5\|6\|8` | smaller and faster, less exact |
| `--low-ram`, `--mlx-cache-limit-gb N`, `--vae-tiling` | save memory |
| `--make-conf` / `-C file` | write and reuse a settings sidecar |
| `--no-exif` | do not embed the prompt and seed in the image |
