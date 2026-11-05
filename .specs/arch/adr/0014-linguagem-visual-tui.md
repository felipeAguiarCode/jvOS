# ADR-0014: Linguagem visual TUI para janelas e apps

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-10-26 |
| **Origem** | commit `c4ccc57` (jv_ide "termide-style TUI"); referências visuais em `.inspo/` (termide, ricing do KDE, player no terminal) |

## Contexto

O jvOS mistura duas estéticas: o holograma do JARVIS (ciano, brilho, HUD) e o gosto do usuário por terminais "riced" no estilo termide, cmus, neofetch e Waybar. As janelas precisavam de uma identidade única, que combinasse com o holograma sem imitar janelas do Windows.

## Decisão

- **Estilo de janela padrão: `tui`.** O alternativo é `holo`; a escolha fica em Menu avançado → Janelas.
- Apps com nomes de terminal e visual de TUI: `jv_ide` (termide), `jv_sh`, `jv_T4p3` (cmus / youtube-music-cli), `jv_lab`, `jv_agent`. O Jarvis Mark mantém o nome do produto.
- Kit comum:
  - `src/lib/tui.ts`: prefs `jarvis.tui` com aberração, brilho e acento, e `tuiSurface()`, que tinge subárvores por variáveis CSS;
  - `src/components/desktop/widgets/tui.tsx`: `BlockBar` `[███░░]`, `KeyValue` no estilo neofetch, `ReverseRow`, `KeyHint` e `EditField`;
  - utilities `tui-surface`, `tui-glow`, `tui-aberration` e `crt-*` em `globals.css`;
  - fonte VT323.
- As cores vêm só dos tokens `hud-*`, trocados pelo tema em tempo de execução ([appearance](../../features/appearance/spec.md)).

## Consequências

- **Positivas:** visual coerente e distinto; widgets e apps reaproveitam componentes; o tema muda tudo de uma vez.
- **Negativas:** desenhar por caracteres limita a densidade de informação e exige cuidado com a largura das fontes.
- **Regras:**
  - widget ou app novo usa o kit TUI e os tokens `hud-*`;
  - atalhos aparecem como `KeyHint`;
  - nenhuma cor fixa.

## Alternativas consideradas

O estilo `holo` continua disponível como opção, não como padrão.

## Referências

- `src/lib/tui.ts`, `src/components/desktop/widgets/tui.tsx`, `src/styles/globals.css`, `src/lib/desktop.ts`
