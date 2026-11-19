// Sends the Claude models of pi's built-in "anthropic" provider through a gateway (LiteLLM), for
// when Claude is not reached directly. The address comes from ANTHROPIC_BASE_URL, the variable
// Claude Code reads too, and the credential from ANTHROPIC_AUTH_TOKEN, which pi sends as a bearer
// token. Without ANTHROPIC_BASE_URL nothing changes: pi talks to api.anthropic.com as usual.
//
// The gateway's certificate is checked against the system keychain too (see below).
//
// The address is read here, not written in models.json, so it does not end up in the dotfiles
// repository (models.json cannot take it from an environment variable).
//
// Which of the gateway's models show up in /model and Ctrl+P is chosen by "enabledModels" in
// settings.json; pi's built-in list has models the gateway may not serve.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as tls from "node:tls";

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return;

  // A company gateway is usually signed by a company CA that is in the macOS keychain, which curl and
  // browsers read but Node does not (nor does NODE_EXTRA_CA_CERTS, if it points to a bundle without it).
  // Trust the system store as well as the usual one, for this pi process only.
  try {
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
  } catch {
    // an older Node: set NODE_OPTIONS=--use-system-ca instead
  }

  pi.registerProvider("anthropic", { baseUrl });
}
