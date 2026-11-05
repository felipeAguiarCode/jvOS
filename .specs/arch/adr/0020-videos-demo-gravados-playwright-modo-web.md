# ADR-0020: Vídeos de demo gravados pelo Playwright no modo web

| | |
|---|---|
| **Status** | Aceito |
| **Data** | 2026-11-04 |
| **Origem** | não commitado (2026-11-04) · pedido do usuário: vídeos mudos, sem legendas, em MP4 para VLC e Windows Media Player, com os roteiros no repositório |

## Contexto

O usuário quis vários vídeos curtos do jvOS rodando, cada um com uma feature num momento do dia, e quis poder regravá-los quando a UI mudar.

- **Captura:** o Playwright 1.64.1 do projeto tem `page.screencast.start({ path, size, fps, quality })`. Ele grava WebM VP9 sem áudio, em cerca de 7 Mbps a 1920×1080/30, e o `showActions` desenha um cursor animado.
- **Os fakes de DEV ([ADR-0011](0011-fakes-de-dev-e-e2e-modo-web.md)) já cobrem quase tudo:** o JARVIS roteirizado, a fala, o clima, as cotações, os medidores, o terminal, o workspace e a música. O `window.__JARVIS__` dispara os mesmos handlers que o motor de voz.
- **O app real é ruim de gravar em série:** precisa fechar o JARVIS do usuário, mexe no `settings.json` real, o microfone do notebook é mudo, e o Claude responde de um jeito diferente e com latência a cada vez.
- **Headless:** o Edge headless cai para o SwiftShader e o perfil `low`. O headed com a GPU real mediu 57 fps no holograma 3D.

## Decisão

- **Gravar no modo web** (`npm run dev:web`) com os fakes de DEV, em Edge **headed**, a 1920×1080 e 30 fps, por `page.screencast`. O áudio sai mudo (`--mute-audio`).
- **Não alterar `src/`.** A pasta `demos/` tem config própria (`demos/playwright.config.ts`, arquivos `*.demo.ts`) e fica fora do `testDir` e do `testMatch` da suíte.
- **A fixture `demos/lib/demo.ts`:**
  - leva o relógio ao horário da cena trocando só o `Date`, sem mexer no rAF nem no `performance.now`;
  - semeia o `localStorage` e liga os fakes antes de a página rodar;
  - faz o holograma "ouvir" e "falar" pelos `signals`, porque o fake de TTS é mudo;
  - esconde os avisos que só existem no navegador.
- **Aquecer o Vite** num projeto `warmup` que abre cada app lazy antes das tomadas, para nenhum vídeo mostrar "Carregando…".
- **Converter para MP4 H.264** (`yuv420p`, `+faststart`) com o ffmpeg do sistema em `demos/run.mjs` (`npm run demo`) e juntar tudo num tour.

## Consequências

- **Positivas:**
  - os vídeos são reproduzíveis, iguais a cada execução e independentes da máquina do usuário;
  - uma mudança de UI se regrava com `npm run demo -- <filtro>`;
  - os roteiros exercitam os fakes e o `__JARVIS__` de ponta a ponta, como testes de fumaça.
- **Negativas / custos:**
  - não há som: nem a voz do JARVIS, nem a música, nem os efeitos;
  - o que só o Rust faz não aparece: transcrição do Whisper, anotação local, abertura de programas, jv_sh real (o terminal fake só faz eco);
  - o estado "falando" do holograma é sintético;
  - depende de dois ffmpeg: o do Playwright (`npx playwright install ffmpeg`) e o completo (`winget install Gyan.FFmpeg.Essentials`).
- **Regras que daqui decorrem:**
  - um roteiro novo é um `demos/NN-nome.demo.ts` que usa `test` e `demo` de `demos/lib/demo.ts`;
  - as janelas abrem fora da faixa do núcleo (`LAYOUT` em `demos/lib/fixtures.ts`), porque ficam acima das falas do JARVIS;
  - um texto que só existe no navegador entra em `HIDE` ou `REPLACE` da fixture, nunca em `src/`.

## Alternativas consideradas

- **OBS ou a Barra de Jogo com áudio, com o roteiro conduzindo o app:** cada vídeo pediria trabalho manual. Ficou de fora quando o usuário escolheu vídeos mudos.
- **App real via CDP na WebView2:** descartado pelos motivos do Contexto.
- **Sintetizar as falas depois e mixar com ffmpeg:** possível, mas fora do escopo pedido.

## Referências

- `demos/playwright.config.ts`, `demos/lib/demo.ts`, `demos/lib/fixtures.ts`, `demos/run.mjs`, `demos/warmup.setup.ts`
- [testing](../testing.md#vídeos-de-demonstração-demos)
- [ADR-0011](0011-fakes-de-dev-e-e2e-modo-web.md)
