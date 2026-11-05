# Vendor: yt-dlp

O programa de linha de comando que o jv_T4p3 roda para achar cada música no YouTube e devolver a URL do stream só de áudio, que a WebView toca direto.

| | |
|---|---|
| **ID** | `vendor/yt-dlp` |
| **Tipo** | Ferramenta externa |
| **Status** | Em uso |
| **Versão** | `yt-dlp.exe` 2026.10.21 nesta máquina (`yt-dlp --version` em 2026-11-05), 17.880.111 bytes em `%LOCALAPPDATA%\dev.jarvis.os\bin\yt-dlp.exe` (a cópia própria, baixada em 2026-10-22). Não é fixada: o app sempre baixa a `releases/latest` e a confere pelo `SHA2-256SUMS` da mesma release. Sem a cópia própria, vale o primeiro `yt-dlp.exe` do `PATH` |
| **Licença** | Unlicense ⚠ inferido — confirmar (o executável não traz o texto da licença) |
| **Fonte** | `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe` e `…/SHA2-256SUMS` (`RELEASES` em `src-tauri/src/music.rs`) |
| **Onde roda** | processo externo, sem janela (`CREATE_NO_WINDOW`), filho do `jarvis.exe`: uma execução por música resolvida |

## Objetivo

Tocar as rádios do Vice City e as playlists de links do YouTube sem baixar música para o disco e sem chave de API: o yt-dlp acha o vídeo e devolve a URL assinada do stream de áudio, e o `<audio>` da WebView a toca. A escolha do yt-dlp, e não de uma API do YouTube ou de outra biblioteca, não está registrada ⚠ inferido — confirmar.

## Não-objetivos

- Não baixa áudio nem vídeo para o disco: só pede a descrição em JSON (`-j`).
- Não lê playlists do YouTube (`--no-playlist`) nem a configuração do usuário (`--no-config`).
- Não usa ffmpeg nem converte formato: toca o `m4a` (AAC) ou o áudio que existir.
- Não fixa versão e não guarda a anterior: atualizar sempre pega a última.

## Critérios de aceite

### Critério 1 (RF-001)

- **Dado** a cópia própria em `bin\yt-dlp.exe`
- **Quando** o jv_T4p3 pede `music_status`
- **Então** a resposta é `{ ytdlp: "ready", version: "2026.10.21", managed: true }`, e a linha de status mostra "atualizar yt-dlp (2026.10.21)".

### Critério 2 (RF-002)

- **Dado** nenhuma cópia própria e nenhum `yt-dlp.exe` no `PATH`
- **Quando** o usuário toca uma música
- **Então** `music_resolve` falha com `yt-dlp-missing`, o quadro "Fita" vira o pedido "Baixar o yt-dlp" com "[ Baixar ]" e "[ Agora não ]", e a música pedida fica guardada.

### Critério 3 (RF-003)

- **Dado** o pedido "Baixar o yt-dlp" aberto e a rede ligada
- **Quando** o usuário clica "[ Baixar ]"
- **Então** aparece "Baixando o yt-dlp oficial (GitHub) e conferindo o SHA-256…" com a barra de progresso; o executável só toma o nome final se o SHA-256 bater com a linha de `yt-dlp.exe` do `SHA2-256SUMS`, e a música que esperava começa no fim.

### Critério 4 (RF-004)

- **Dado** respostas estranhas do yt-dlp e links colados
- **Quando** `cargo test --lib -- music::` roda em `src-tauri`
- **Então** passam `rejects_odd_resolutions` (URL `http://`, outro host e `user@` recusados) e `pasted_links_need_a_real_video_id` (`--exec=calc` vira "Link do YouTube inválido").

### Critério 5 (RNF-001)

- **Dado** o YouTube sem responder
- **Quando** a busca passa de 40 s
- **Então** o processo é morto e o erro é "O YouTube demorou demais para responder".

### Critério 6 (RF-005)

- **Dado** uma música já tocada nesta sessão, com o stream ainda longe de expirar
- **Quando** a mesma busca é pedida de novo
- **Então** nenhum yt-dlp roda e a resposta sai em menos de 50 ms (teste ignorado `installs_and_resolves_for_real`).

## Casos de borda

- **Vazio/nulo:** sem yt-dlp → `yt-dlp-missing` e o pedido de download. Sem rede, o download falha com "Falha no download: <motivo>" e cada música falha no YouTube. Um `SHA2-256SUMS` sem a linha do executável dá "A lista de verificação do yt-dlp não tem o executável".
- **Duplicidade/idempotência:** um segundo `music_install` durante o primeiro recebe "O yt-dlp já está sendo baixado". Atualizar baixa de novo e substitui a cópia própria. Uma busca repetida usa o cache de busca e de stream, sem novo processo.
- **Concorrência/corrida:** cada busca roda num `spawn_blocking`, e os dois pipes são lidos em threads próprias para o JSON grande não travar o processo. O `--version` é guardado por caminho e data de modificação, porque custa cerca de 1 s de CPU (o executável é um PyInstaller); uma atualização ou outra cópia no `PATH` o refaz.
- **Permissões/visibilidade:** o stream só é aceito com `https://` num host `*.googlevideo.com` sem `@`, e a CSP só libera esse host em `media-src`. O id de vídeo tem 11 caracteres `[A-Za-z0-9_-]` e a busca vai como `ytsearch1:<texto>`, então nada vira opção da linha de comando. Uma cópia posta à mão em `bin\` ou achada no `PATH` não tem o hash conferido.

## Uso no jvOS

### Localizar e versionar (`src-tauri/src/music.rs`, `Music::executable` e `status`)

Decide qual yt-dlp usar e diz a versão.

- **Comportamento:**
  - **RF-001**: O jvOS DEVE usar a cópia própria `%LOCALAPPDATA%\dev.jarvis.os\bin\yt-dlp.exe` quando ela existe e, senão, o primeiro `yt-dlp.exe` do `PATH`. `status` diz `missing`, `ready` ou `installing`, a versão de `yt-dlp --version` (limite de 20 s) e se é a cópia própria (`managed`).

### Instalar e atualizar (`src-tauri/src/music.rs` `Music::install`, `src-tauri/src/lib.rs` `music_install`)

Baixa a release oficial conferida.

- **Comportamento:**
  - **RF-003**: `install` DEVE baixar o `SHA2-256SUMS` da `releases/latest` (até 64 KiB), achar a linha de `yt-dlp.exe`, baixar o executável (até 64 MiB) em `yt-dlp.part` e só renomeá-lo quando o SHA-256 bater. O progresso sai em `music:install-progress { id: "yt-dlp", received, total }` e o fim em `music:install-done { version, error }`.
  - Só uma instalação por vez (`installing`).

### Resolver uma música (`src-tauri/src/music.rs`, `resolve`, `resolve_video`, `extract` e `run`)

Roda o yt-dlp e lê a resposta.

- **Comportamento:**
  - **RF-002**: Sem yt-dlp, `extract` DEVE falhar com o sentinela `yt-dlp-missing`.
  - **RF-006**: O jvOS DEVE rodar só `yt-dlp --no-config --no-playlist --no-warnings -f bestaudio[ext=m4a]/bestaudio -j <alvo>`, com o alvo `ytsearch1:<busca>` (busca de 1 a 200 caracteres, espaços normalizados) ou `https://www.youtube.com/watch?v=<id>`. O processo é morto depois de 40 s.
  - **RF-004**: A resposta DEVE ser a primeira linha que começa com `{`, com um `id` de vídeo válido e uma `url` `https://` em `*.googlevideo.com`; `expire=` da URL dá a validade.
  - **RF-005**: Busca → id e id → stream DEVEM ficar em cache na memória da sessão, até 120 s antes de o stream expirar.
  - Se o yt-dlp falhar, então o erro é "yt-dlp: <última linha do stderr, sem `ERROR:`>".

### Reprodução e pedido na UI (`src/hooks/useMusicPlayer.ts`, `src/components/desktop/apps/TapePlayer.tsx`, `src-tauri/tauri.conf.json`)

Toca a URL e oferece o download.

- **Comportamento:**
  - A CSP libera `https://*.googlevideo.com` em `media-src`, e o `<audio>` toca a URL direto.
  - Se chegar `yt-dlp-missing`, então o hook guarda a música e abre o pedido "Baixar o yt-dlp", que explica "O jv_T4p3 usa o yt-dlp (~18 MB) para achar cada música no YouTube e tocar só o áudio."; quando `music:install-done` chega sem erro, a música pendente toca.

## Restrições

- **RNF-001**: Limites de tempo: 40 s por busca e 20 s para `--version`.
- **RNF-002**: Executável de ~18 MB (17.880.111 bytes aqui), aceito até 64 MiB; lista de hashes até 64 KiB.
- **RNF-003**: Precisa de rede: GitHub para instalar e YouTube a cada música que não está no cache.
- **RNF-004**: Versão sem trava (`releases/latest`) e sem volta pelo app: a atualização substitui a cópia própria.
- **RNF-005**: O nome do executável é `yt-dlp.exe` no Windows e `yt-dlp` fora dele.
- **RNF-006**: Licença Unlicense ⚠ inferido — confirmar.

## Entregáveis

### Arquivos

| Arquivo | Papel |
|---|---|
| `src-tauri/src/music.rs` | `Music`: localizar, instalar, rodar e validar o yt-dlp; caches da sessão |
| `src-tauri/src/download.rs` | `fetch_text` (`SHA2-256SUMS`) e `fetch_verified` (executável) |
| `src-tauri/src/lib.rs` | `music_status`, `music_install`, `music_resolve`, eventos `music:install-*`, `bin_dir` |
| `src-tauri/tauri.conf.json` | CSP com `media-src … https://*.googlevideo.com` |
| `src/hooks/useMusicPlayer.ts` | Estado do yt-dlp, `yt-dlp-missing`, música pendente e o falso `__JARVIS_MUSIC__` do modo web |
| `src/components/desktop/apps/TapePlayer.tsx` | Pedido "Baixar o yt-dlp" e "atualizar yt-dlp (<versão>)" |

### Testes

- `cargo test --lib -- music::` (em `src-tauri`, com `CMAKE` e `LIBCLANG_PATH`): hash da lista, leitura do JSON, respostas estranhas, busca normalizada, ids colados e mensagens de erro.
- `cargo test --lib -- --ignored installs_and_resolves_for_real --nocapture`: instala numa pasta temporária, resolve "Blondie - Atomic" e confere o cache; `JARVIS_KEEP_YTDLP=<pasta>` guarda o executável. Usa a rede.
- `npx playwright test tests/music.spec.ts`: o jv_T4p3 no modo web com o falso `__JARVIS_MUSIC__`, sem o yt-dlp real.
- Conferência manual: `& "$env:LOCALAPPDATA\dev.jarvis.os\bin\yt-dlp.exe" --version`.

### Atualização e reversão

- **Comando:** "atualizar yt-dlp (<versão>)" na linha de status do jv_T4p3 (`music_install`), que baixa a `releases/latest`.
- **Prova:** `cargo test --lib -- music::`, o teste ignorado `installs_and_resolves_for_real` e uma rádio tocando no jv_T4p3.
- **Sinal de volta:** toda música falha com "yt-dlp: …" ou "O yt-dlp não devolveu um stream de áudio".
- **Reversão:** não há botão. Baixe a release anterior à mão (`https://github.com/yt-dlp/yt-dlp/releases/download/<tag>/yt-dlp.exe`) para `%LOCALAPPDATA%\dev.jarvis.os\bin\`; o jvOS não confere o hash de uma cópia posta assim.

### Decisões relacionadas

- [ADR-0011 — Fakes de desenvolvimento nos adaptadores; E2E no modo web; app real via CDP](../../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)

## Dependências

- [http](../http/spec.md) e [archives](../archives/spec.md): `ureq` e `sha2` no download.
- [serde](../serde/spec.md): o `serde_json` lê o `-j`. [tauri](../tauri/spec.md): eventos e CSP.
- [jv_t4p3](../../../apps/jv_t4p3/spec.md), [tape](../../../widgets/tape/spec.md), [miniplayer](../../../widgets/miniplayer/spec.md), [voice-commands](../../../features/voice-commands/spec.md) (`music:*`), [search](../../../features/search/spec.md).
- Sistema: rede até o GitHub e o YouTube, `%LOCALAPPDATA%\dev.jarvis.os\bin` ([persistence](../../../domain/persistence.md)) e o `<audio>` do WebView2.

## Pendências

Nenhuma por enquanto.
