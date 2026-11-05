# App: jv_T4p3

O tocador de música do jvOS, um player de terminal que toca as rádios do GTA: Vice City e as playlists de links do YouTube do usuário.

| | |
|---|---|
| **ID** | `app/jv_t4p3` |
| **Status** | Implementado |
| **Origem** | `42e671a` (2026-10-23) · evoluída em `e7151cf` (2026-11-05): confirmação falada dos comandos de voz |
| **Window kind** | `music` em `src/lib/desktop.ts` (920×620, mínimo 660×480, grupo `apps`) |
| **Voz** | `window:music`, `music:resume`, `music:pause`, `music:next`, `music:previous`, `music:nextPlaylist`, `music:previousPlaylist`, `music:play` (verbos de tocar) |

## Objetivo

O jv_T4p3 é o tocador de música do jvOS, um player de terminal no estilo do youtube-music-cli/cmus. Suas playlists são as sete rádios musicais do GTA: Vice City, mais as playlists do próprio usuário, feitas de links do YouTube. Cada música é procurada no YouTube na hora de tocar, e só o áudio é reproduzido, sem baixar nada para o disco. O player é único para o app inteiro: a música continua com a janela fechada, e os widgets [Fita](../../widgets/tape/spec.md) e [Mini player](../../widgets/miniplayer/spec.md), a barra superior, a Busca e a voz controlam o mesmo player.

## Não-objetivos

- Não baixa músicas para ouvir offline; precisa de rede para o YouTube.
- Não lê playlists do YouTube: cada link vira uma faixa (`--no-playlist`).
- As rádios são fixas no código; só as playlists do usuário são editáveis.
- Os caches de busca e de stream no Rust vivem só na memória da sessão, sem limite de tamanho.
- Os widgets Fita e Mini player e o módulo de música da barra superior têm specs próprias; aqui só o player.
- O chrome da janela e o carregamento lazy são de [desktop-windows](../../features/desktop-windows/spec.md).
- As frases e o matcher de voz são de [voice-commands](../../features/voice-commands/spec.md); a lista de intents fica em [voice-intents.md](../../domain/voice-intents.md).

## Histórias de usuário

### US1 — Tocar uma rádio do Vice City (P1)

Como usuário, abro o jv_T4p3, escolho uma rádio e uma música e ouço, vendo a fita girar.

**Por que P1:** é o uso principal.
**Teste independente:** `tests/music.spec.ts` — "jv_T4p3 lists the Vice City stations and plays one, with the cassette turning".

**Aceite:** [critérios 1 a 6](#critérios-de-aceite).

### US2 — Minhas playlists de links do YouTube (P1)

Como usuário, crio uma playlist, colo links do YouTube, renomeio, apago e toco.

**Por que P1:** é o que torna o player útil além das rádios.
**Teste independente:** "playlists of YouTube links are created, edited, kept and played".

**Aceite:** [critérios 7 a 11](#critérios-de-aceite).

### US3 — A música continua fora da janela (P1)

**Teste independente:** "the Fita and Mini player widgets follow the music, which goes on with the player closed".

**Aceite:** [critérios 12 a 13](#critérios-de-aceite).

### US4 — Comandar por voz (P2)

**Teste independente:** "voice plays playlists, skips, pauses and opens or closes the player and its widgets".

**Aceite:** [critérios 14 a 19](#critérios-de-aceite).

### US5 — Tocar pela Busca (P3)

**Teste independente:** "the search plays a station and opens the player".

**Aceite:** [critérios 20 a 21](#critérios-de-aceite).

### US6 — Instalar o yt-dlp (P2)

Como usuário sem yt-dlp, quero que o player ofereça baixá-lo e toque a música assim que terminar.

**Aceite:** [critérios 22 a 24](#critérios-de-aceite).

## Critérios de aceite

### Critério 1 (US1)

- **Dado** o player aberto pela primeira vez
- **Quando** olho a lista "Playlists"
- **Então** vejo Wildstyle, Flash FM, Fever 105, V-Rock, Radio Espantoso, Emotion 98.3 e Wave 103, com Flash FM selecionada e suas 16 faixas.

### Critério 2 (US1)

- **Dado** o modo navegador sem o fake
- **Quando** aperto Enter
- **Então** a linha de status mostra "Erro: Disponível no app desktop".

### Critério 3 (US1)

- **Dado** uma música no cursor
- **Quando** aperto Enter
- **Então** o status mostra "Sintonizando:" e depois `Tocando agora: <título> — <artista>`, a faixa ganha "►", a fita mostra o nome da rádio e da música e gira, e o tempo e a barra avançam.

### Critério 4 (US1)

- **Dado** uma música tocando
- **Quando** aperto espaço
- **Então** o status vira "Pausado:" e a fita para; espaço de novo retoma.

### Critério 5 (US1)

- **Dado** uma música tocando
- **Quando** aperto `n` / `b`
- **Então** vai para a próxima / anterior; `-`/`+` mudam o volume em 5% e `s` liga o aleatório, e ambos ficam salvos.

### Critério 6 (US1)

- **Dado** uma música que termina
- **Quando** acaba
- **Então** a próxima começa sozinha.

### Critério 7 (US2)

- **Dado** o player
- **Quando** aperto `p`, digito "Treino" e Enter
- **Então** a playlist é criada e selecionada, aparece "Playlist vazia…", e o foco vai para o campo "Link do YouTube".

### Critério 8 (US2)

- **Dado** o campo de link
- **Quando** colo `youtube.com/watch?v=…`, `youtu.be/…` ou `/shorts/…` e aperto Enter
- **Então** o vídeo entra na lista e o campo esvazia.

### Critério 9 (US2)

- **Dado** um link de outro site
- **Quando** aperto Enter
- **Então** aparece "Isso não parece um link do YouTube"; um vídeo repetido dá "Esse vídeo já está na playlist".

### Critério 10 (US2)

- **Dado** uma faixa
- **Quando** clico no × (ou Delete)
- **Então** ela sai; "renomear" troca o nome; tudo continua após recarregar.

### Critério 11 (US2)

- **Dado** a playlist tocando
- **Quando** clico "apagar" e confirmo "[s] sim"
- **Então** a playlist some e a música dela para; "[n] não" cancela.

### Critério 12 (US3)

- **Dado** uma música tocando
- **Quando** fecho a janela do jv_T4p3
- **Então** a música segue e a barra superior mostra o título.

### Critério 13 (US3)

- **Dado** os widgets Fita e Mini player abertos
- **Quando** pulo ou pauso em qualquer um deles ou na barra superior
- **Então** todos refletem o mesmo estado.

### Critério 14 (US4)

- **Dado** o desktop
- **Quando** digo "abre o player" ou "fecha o tape" (`window:music`)
- **Então** a janela abre ou fecha.

### Critério 15 (US4)

- **Dado** o player fechado
- **Quando** digo "toca a Fever" (ouvido como "fever cento e cinco")
- **Então** toca Fever 105 desde a primeira música (ou uma aleatória com o aleatório ligado), a dock mostra "Tocando Fever 105" e a janela continua fechada.

### Critério 16 (US4)

- **Dado** uma música tocando
- **Quando** digo "próxima música", "música anterior", "pausa a música" ou "continua a música"
- **Então** o player obedece e a dock confirma ("Próxima música", "Música anterior", "Música pausada", "Tocando").

### Critério 17 (US4)

- **Dado** uma rádio tocando
- **Quando** digo "muda a playlist" / "playlist anterior"
- **Então** toca a próxima / anterior playlist que tem músicas.

### Critério 18 (US4)

- **Dado** um nome que não existe
- **Quando** digo "toca samba de raiz"
- **Então** a dock diz "Não achei a playlist “samba de raiz”" e nada muda.

### Critério 19 (US4)

- **Dado** uma playlist minha chamada "Treino pesado"
- **Quando** digo "toca treino"
- **Então** ela toca.

### Critério 20 (US5)

- **Dado** a Busca (`/`)
- **Quando** digito "tocar emotion" e Enter
- **Então** o player abre e toca Emotion 98.3 desde a primeira música.

### Critério 21 (US5)

- **Dado** algo tocando
- **Quando** busco "pausar a musica" ou "proxima musica"
- **Então** o player pausa ou pula.

### Critério 22 (US6)

- **Dado** uma máquina sem yt-dlp
- **Quando** dou play
- **Então** o quadro "Fita" vira o pedido "Baixar o yt-dlp" com "[ Baixar ]" e "[ Agora não ]".

### Critério 23 (US6)

- **Dado** o pedido
- **Quando** clico "[ Baixar ]"
- **Então** aparece "Baixando o yt-dlp oficial (GitHub) e conferindo o SHA-256…" com uma barra de progresso, e a música que esperava começa ao fim.

### Critério 24 (US6)

- **Dado** a cópia do JARVIS instalada
- **Quando** olho o rodapé
- **Então** há `atualizar yt-dlp (<versão>)`.

## Casos de borda

- **Vazio/nulo:**
  - Enter no campo "Link do YouTube" vazio → nada acontece.
  - Nome vazio no `NameField` → cancela; pela janela, nunca cria a playlist.
  - Playlist do usuário sem músicas → "Playlist vazia: cole um link do YouTube acima (…)"; "muda a playlist" a pula e, sem nenhuma com músicas, diz "Nenhuma playlist com músicas".
  - `music_resolve` sem `query` nem `videoId` → "Nada para tocar"; `music:play` sem nome → `resume`.
  - `jarvis.music` inválido → cada campo volta ao padrão (Flash FM, cursor 0, volume 80%, aleatório desligado); um id de playlist que não existe mais mostra Wildstyle.
- **Duplicidade/idempotência:**
  - Vídeo que já está na playlist → "Esse vídeo já está na playlist".
  - Enter, Esc e a perda de foco no `NameField` → respondem uma vez só.
  - `music_install` com um download em andamento → "O yt-dlp já está sendo baixado".
  - A mesma busca de novo → reusa o id do vídeo e o stream do cache enquanto ele estiver a mais de 120 s de expirar (RNF-002); a versão do yt-dlp fica em cache até o executável mudar.
- **Concorrência/corrida:**
  - Play sem yt-dlp → a música pedida fica guardada e toca quando `music:install-done` chega sem erro.
  - Download interrompido ou com SHA-256 errado → o `yt-dlp.part` nunca vira `yt-dlp.exe`; "Arquivo corrompido (verificação SHA-256 falhou)" e o parcial é apagado.
  - "[s] sim" em "apagar" na playlist que toca → a música para; trocar de playlist cancela um "renomear" ou "apagar" em andamento.
  - Música que não carrega → pula para a próxima depois de 3 s, até 3 falhas seguidas; com uma faixa só, não pula.
  - yt-dlp sem resposta em 40 s → "O YouTube demorou demais para responder" (RNF-001).
- **Permissões/visibilidade:**
  - Rede só para o YouTube e o GitHub; a WebView só toca `https://*.googlevideo.com` sem `@` (RF-008 e CSP `media-src`).
  - O yt-dlp roda com argumentos fixos e `--no-config`; a busca vai como `ytsearch1:<texto>`, e um id de vídeo fora de 11 caracteres `[A-Za-z0-9_-]` → "Link do YouTube inválido".
  - Link numa rádio → "Só dá para adicionar links às suas playlists".
  - Fora do Tauri e sem `__JARVIS_MUSIC__` → "Disponível no app desktop", sem pular para a próxima.
  - A cópia própria do yt-dlp fica em `%LOCALAPPDATA%\dev.jarvis.os\bin\`, fora de `Documentos\JARVIS`, e só é usada com o SHA-256 conferido.

## Dados

- `$prefs`: `{ stationId, cursor, volume (0..1), shuffle }`, com padrão `{ "flash", 0, 0.8, false }`. Fica em `jarvis.music` (localStorage via `useStoredState`, debounce de 250 ms). Um `stationId` desconhecido cai na primeira rádio. Ver [persistência](../../domain/persistence.md).
  - **RF-006**: DEVE lembrar a playlist mostrada, o cursor, o volume e o aleatório, e as playlists do usuário.
  - Se o dado salvo for inválido, cada campo volta ao padrão (Flash FM, cursor 0, volume 80%, aleatório desligado). Um id de playlist que não existe mais mostra a primeira rádio (Wildstyle).
- `$minhas_playlists`: `[{ id: "pl-…", name, genre: "Playlist", host: "você", tracks: [{ videoId, artist, title }], custom: true }]`. Fica em `jarvis.music.playlists` (debounce de 250 ms). `parsePlaylists` valida campo a campo: ids `pl-…`, `videoId` revalidado por `parseYoutubeId`, artista com até 120 caracteres, título com até 200 e até 500 faixas. Playlists e faixas malformadas são descartadas.
- `$ytdlp_exe`: a cópia própria do yt-dlp em `%LOCALAPPDATA%\dev.jarvis.os\bin\yt-dlp.exe`, o binário oficial. É baixada em `yt-dlp.part` e renomeada depois de conferido o SHA-256.
- Só em memória (ver [glossário](../../domain/glossary.md)):
  - **Estação / Playlist** (`Station`): id, nome, gênero, locutor e faixas; `custom` para as do usuário.
  - **Faixa** (`Track`): artista, título, `query` opcional (busca especial) ou `videoId` (link colado).
  - `$tocando` — **Tocando agora** (`NowPlaying`): playlist, índice e faixa em execução.
  - `$resolução` — **Resolução** (`Resolved`): URL do stream, título, canal, duração e expiração.
  - `$ytdlp` — **Estado do yt-dlp** (`Ytdlp`): `unknown`, `missing`, `ready` ou `installing`; versão; se é a cópia própria; progresso.
  - O relógio da música (posição e duração) fica fora do estado React (`createClock`, `useMusicTime`).

## Telas

O jv_T4p3 é uma janela só. O que muda é a playlist mostrada (uma rádio ou uma do usuário) e o quadro "Fita", que vira o pedido do yt-dlp quando falta o programa.

### Player

A janela inteira: playlists à esquerda, músicas à direita, a fita embaixo delas e "Tocando agora" no rodapé. Tudo se alcança pelo teclado.

- **Comportamento:**
  - Ao abrir, a janela pega o foco e pede o estado do yt-dlp (`refreshYtdlp`).
  - As teclas de uma letra valem com o foco no player. Dentro de um campo, elas digitam. Um botão com foco trata o próprio Enter e o próprio espaço. Com Ctrl, Alt ou Meta, a tecla passa direto.
  - Um clique fora de botões e campos devolve o foco ao player.
  - O cursor de músicas fica sempre à vista (`scrollIntoView`).
  - Trocar de playlist cancela um "renomear" ou um "apagar" em andamento.
- **Layout:**
  - Uma coluna com, de cima para baixo: o título "♪ ► jv_T4p3 ► ♪" num `Box`, uma grade de duas colunas, o `Box` de "Tocando agora" e a linha de dicas de teclas.
  - A grade tem a coluna `minmax(180px,28%)` com a lista "Rádios" e, à direita, a lista de músicas em cima e o quadro "▪ Fita" embaixo.
- **Estilo:**
  - `font-mono` 12,5 px, `leading-snug`, `text-hud-text`, sem seleção de texto, com `p-2` e `gap-2`.
  - O título fica centralizado, em 14 px, semibold e `text-hud-light`.

### Rádio mostrada

Uma rádio do Vice City na lista de músicas.

- **Comportamento:**
  - A lista mostra as faixas na ordem do jogo e não pode ser editada.
- **Layout:** o `Box` da lista tem o título "♫ <nome>" e, à direita, "<n> faixas". O rodapé da lista "Rádios" mostra o gênero e "DJ <locutor>".

### Playlist do usuário mostrada

Uma playlist de links do YouTube na lista de músicas, com edição.

- **Comportamento:**
  - Mostre o campo "Link do YouTube", as ações "renomear" e "apagar" e o × de cada faixa.
  - Se a playlist estiver vazia, mostre "Playlist vazia: cole um link do YouTube acima (youtube.com/watch, youtu.be, shorts, Music)."
  - `a` foca o campo de link e `Delete` remove a faixa do cursor. As duas teclas só valem aqui.
- **Layout:** o campo de link fica acima das músicas. O rodapé da lista "Rádios" mostra "<n> links do YouTube" (ou "1 link do YouTube") e "sua playlist".
- **Estilo:** o texto de playlist vazia fica em `text-hud-text/45`.

### Pedido do yt-dlp

O quadro "Fita" trocado pelo `YtdlpPrompt` enquanto falta o yt-dlp ou enquanto ele é baixado.

- **Comportamento:**
  - Mostre o pedido quando `needsYtdlp` for verdadeiro ou `$ytdlp` estiver em `installing`. Nos outros casos, mostre a fita.
- **Layout:** ocupa o lugar da fita, dentro do mesmo `Box` "▪ Fita".

## Componentes

### `Box`

O painel de borda fina e cantos arredondados, como no youtube-music-cli.

- **Comportamento:**
  - Mostre o cabeçalho só se houver título, texto lateral (`aside`) ou ações.
- **Layout:** cabeçalho com o título à esquerda, as ações no meio e o `aside` à direita; o conteúdo embaixo.
- **Estilo:** `rounded-md`, borda `hud-cyan/35`, `px-3 py-2`. O título é semibold `text-hud-cyan`; o `aside` fica em 11 px `text-hud-text/45`.

### Lista "Rádios" (`PlaylistRow`)

As rádios e, abaixo de "♫ Minhas playlists", as playlists do usuário, com "+ nova playlist" no fim.

- **Comportamento:**
  - Um clique mostra a playlist (`select`), sem tocar. O cursor vai para a primeira música ou, na playlist que está no ar, para a música que toca. Um duplo clique toca a primeira música dela, se houver músicas.
  - A playlist que está no ar ganha "♪" enquanto toca e "·" quando parada (rótulo "no ar").
  - "+ nova playlist" (ou `p`) troca o botão pelo campo "Nome da nova playlist" (`NameField`).
- **Layout:** `listbox` "Playlists" com rolagem. No rodapé, separado por uma linha, as duas linhas de detalhe da playlist mostrada.
- **Estilo:**
  - A playlist mostrada fica em vídeo reverso: `bg-hud-light/85`, semibold, `text-hud-void`. As outras ganham `bg-hud-cyan/10` no hover.
  - "♫ Minhas playlists" fica semibold em `text-hud-cyan`. "+ nova playlist" fica em `text-hud-text/55` e vira `text-hud-light` no hover ou foco.
  - O rodapé tem borda superior `hud-cyan/15`, 11 px e `text-hud-text/45`.

### Lista de músicas

As faixas da playlist mostrada, com o cursor e a faixa no ar.

- **Comportamento:**
  - Um clique move o cursor. Enter ou um duplo clique tocam a faixa.
  - A faixa no ar ganha "►" e fica em `text-hud-light`.
  - Numa playlist do usuário, o × "Remover <título>" tira a faixa. Ele aparece na linha do cursor e, nas outras, só no hover ou no foco.
- **Layout:** `listbox` "Músicas de <nome>" com rolagem. Cada linha tem uma coluna de 1 caractere para o "►", o título e " — <artista>" truncados e o × no fim.
- **Estilo:**
  - O cursor tem fundo `bg-hud-cyan/12`; as outras linhas, `bg-hud-cyan/[0.06]` no hover.
  - O título é semibold; " — <artista>" fica em `text-hud-text/45`.
  - O × fica em `text-hud-text/50` e vira `text-hud-alert` no hover ou foco.

### Campo de nome (`NameField`)

A linha que dá nome a uma playlist nova ou renomeia a mostrada.

- **Comportamento:**
  - Ao aparecer, o campo pega o foco e seleciona o texto. Enter ou sair do campo salvam; Esc cancela. Enter, Esc e a perda de foco respondem uma vez só.
  - Um nome vazio cancela. Pela janela, um nome vazio nunca cria a playlist; o "Playlist N" de `createPlaylist` vale para quem chama o hook direto.
  - Depois de criar, a nova playlist fica selecionada e o foco vai para o campo "Link do YouTube".
- **Layout:** uma linha na largura toda, com o placeholder "nome da playlist". O de renomear ("Novo nome da playlist") toma o lugar do título do `Box` das músicas.
- **Estilo:** até 40 caracteres, borda `hud-light/50`, fundo transparente, texto selecionável.

### Campo "Link do YouTube"

Onde o usuário cola um link para acrescentar à playlist mostrada.

- **Comportamento:**
  - **RF-005**: DEVE aceitar links `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/live/`, `/v/`, YouTube Music e um id puro de 11 caracteres; o título e o artista vêm do próprio vídeo depois de adicionado.
  - Ao Enter, um campo vazio não faz nada. Com um link válido, o vídeo entra no fim da lista como `youtu.be/<id>`, o campo esvazia e aparece "Adicionado. O título vem do próprio vídeo.".
    - O título e o artista chegam depois, por `music_resolve` e `splitVideoTitle` (que tira "(Official Video)", " - Topic", "VEVO").
  - Se o link for de outro site, mostre "Isso não parece um link do YouTube". Se o vídeo já estiver na playlist, mostre "Esse vídeo já está na playlist".
  - Se a playlist já tiver 500 músicas, mostre "Limite de 500 músicas por playlist".
  - A mensagem some depois de 4 s (`NOTE_MS`). Esc devolve o foco ao player.
- **Layout:** uma linha com "+" e o campo (placeholder "cole um link do YouTube e aperte Enter"), e a mensagem embaixo.
- **Estilo:** borda `hud-cyan/25`, que vira `hud-light/60` com o foco; "+" em `text-hud-light`. A mensagem fica em 11 px, `text-hud-alert` no erro e `text-hud-text/55` no aviso.

### Renomear e apagar

As ações da playlist do usuário no cabeçalho da lista de músicas.

- **Comportamento:**
  - "renomear" abre o `NameField` já preenchido com o nome atual.
  - "apagar" pede a confirmação "apagar “<nome>”?". "[s] sim" apaga a playlist e, se ela estiver tocando, para a música. "[n] não" cancela.
  - "[s] sim" e "[n] não" são botões, não teclas: no player, `s` liga o aleatório e `n` pula a música.
- **Layout:** à direita do título, em 11 px.
- **Estilo:** "renomear", "apagar" e "[n] não" ficam em `text-hud-text/60`, com `text-hud-light` no hover. A pergunta e "[s] sim" ficam em `text-hud-alert`; "[s] sim" ganha sublinhado no hover.

### Fita (`cassette`, `useTapeTick`)

A fita cassete desenhada em texto, com o nome da rádio e da música no rótulo.

- **Comportamento:**
  - O rótulo mostra o nome da playlist no ar (ou da mostrada) e, embaixo, `nowLabel`: "<título> — <artista>", "sintonizando…", o erro ou "aperte Enter para tocar".
  - Os carretéis giram enquanto toca. A fita passa do carretel da esquerda para o da direita conforme o progresso da música.
  - Com "movimento reduzido", os carretéis param, mas a fita ainda anda com a música.
  - Com o aleatório ligado, o `Box` mostra "aleatório" à direita.
- **Layout:** `<pre>` centralizado de 48 colunas e 12 linhas, dentro do `Box` "▪ Fita".
- **Estilo:** 12 px, `leading-[1.2]`, `text-hud-light`. Só usa glifos de largura simples que a Consolas tem, para não quebrar as colunas.

### "Tocando agora" (`ProgressBar`)

O rodapé com o status, o tempo e a barra de progresso.

- **Comportamento:**
  - O status diz "Sintonizando:", "Pausado:" ou "Tocando agora:" seguido de "<título> — <artista>". No erro, "Erro: <mensagem>". Sem nada tocando, "Nada tocando · escolha uma playlist e aperte Enter".
  - O tempo aparece como `m:ss / m:ss` (`clock`).
  - Apertar a barra leva a música para aquele ponto (`seekTo`).
- **Layout:** uma linha com "▌", o status truncado (`role="status"`) e o tempo à direita; a barra embaixo, na largura toda.
- **Estilo:**
  - O prefixo e o artista ficam em `text-hud-text/60`, o título em `text-hud-light`, o erro em `text-hud-alert` e "Nada tocando…" em `text-hud-text/45`. O tempo usa números tabulares.
  - A barra tem 2,5 de altura (`h-2.5`), fundo `bg-hud-text/10` e o preenchimento na cor fixa `TAPE_MAGENTA` (`oklch(0.68 0.21 330)`), "como no youtube-music-cli".

### Dicas de teclas (`KeyHint`)

A linha de botões `[tecla] ação` no pé da janela.

- **Comportamento:**
  - Cada dica é também um botão: espaço "tocar"/"pausar", `b` "anterior", `n` "próxima", `,` "-10s", `.` "+10s", `-` e `+` "vol", `s` "aleatório: on"/"aleatório: off", `p` "nova playlist" e, numa playlist do usuário, `a` "link".
  - Depois delas, o texto "↑↓ músicas · ←→ playlists · Enter toca", com " · Del remove" numa playlist do usuário.
  - À direita, "atualizar yt-dlp (<versão>)" quando o JARVIS usa a cópia própria e ela está pronta, e "vol <n>%".
- **Layout:** linha com quebra (`flex-wrap`); a versão do yt-dlp e o volume ficam à direita (`ml-auto`).
- **Estilo:** kit TUI `KeyHint`: 11 px, ação em `text-hud-text/60`, tecla em `text-hud-cyan` sobre `bg-hud-text/12`, que vira vídeo reverso (`bg-hud-light/85`, `text-hud-void`) no hover. O texto das setas fica em `text-hud-text/40`.

### `YtdlpPrompt`

O pedido para baixar o yt-dlp e o progresso do download.

- **Comportamento:**
  - Sem yt-dlp, explique "O jv_T4p3 usa o yt-dlp (~18 MB) para achar cada música no YouTube e tocar só o áudio." e "Ele fica na pasta do JARVIS e pode ser atualizado daqui.", com "[ Baixar ]" e "[ Agora não ]".
  - "[ Baixar ]" chama `installYtdlp`. "[ Agora não ]" chama `dismissYtdlp` e volta a fita.
  - Durante o download, mostre "Baixando o yt-dlp oficial (GitHub) e conferindo o SHA-256…" com a barra de progresso. Ao fim, a música que esperava começa.
  - Se a instalação falhar, o erro aparece no pedido.
- **Layout:** `alertdialog` "Baixar o yt-dlp": os dois parágrafos, o erro e a linha dos dois botões. No download, o texto e um `BlockBar` de 30 células ("Download do yt-dlp").
- **Estilo:** "yt-dlp" em `text-hud-light`; o segundo parágrafo em `text-hud-text/50`; o erro em `text-hud-alert`. "[ Baixar ]" fica em vídeo reverso (`bg-hud-light/85`, semibold, `text-hud-void`); "[ Agora não ]" em `text-hud-text/60`.

### Player do app (`useMusicPlayer`)

O hook, instanciado uma vez no `App`, que guarda o áudio e todo o estado de reprodução.

- **Comportamento:**
  - **RF-004**: DEVE ter um único elemento de áudio para o app inteiro, que segue tocando com a janela fechada.
  - A janela, os widgets Fita e Mini player, a barra superior, a Busca e a voz recebem o mesmo `MusicPlayer`. Pular ou pausar em qualquer um deles muda o estado de todos.
  - `play(station, index)` resolve a faixa (`music_resolve`) e toca a URL. O status passa por `resolving` e depois `playing`; a cada faixa que começa, o holograma pulsa (`onTrackStart: audio.pulse`).
  - Quando a música termina, a próxima começa sozinha.
  - **RF-010**: DEVE adiantar a busca da próxima faixa enquanto a atual toca (no Tauri e sem aleatório).
  - `next` e `prev` andam na playlist que está no ar.
    - Se "Anterior" vier com mais de 3 s de música, recomece a faixa em vez de voltar.
    - Com o aleatório, sorteie outra faixa da mesma playlist (nunca a mesma, se houver mais de uma).
  - `seek` anda ±10 s e `seekTo` vai a uma fração da música. O volume anda em passos de 5%.
  - Se uma música não carregar, pule para a próxima depois de 3 s, até 3 falhas seguidas. Com uma faixa só, não pule.
  - Se o stream falhar no meio, mostre "O stream de áudio falhou".
  - Se estiver fora do Tauri e sem `__JARVIS_MUSIC__`, tocar dá "Disponível no app desktop" e não pula para a próxima.
  - Sem yt-dlp, o Rust responde o erro sentinela `yt-dlp-missing`: o hook guarda a música pedida e abre o pedido do yt-dlp. Quando `music:install-done` chega sem erro, toca a música pendente.

### Rádios do Vice City (`stations.ts`)

As sete rádios fixas no código.

- **Comportamento:**
  - **RF-001**: O sistema DEVE oferecer as 7 rádios musicais do GTA: Vice City, com as faixas na ordem do jogo (Wildstyle 15, Flash FM 16, Fever 105 13, V-Rock 17, Radio Espantoso 14, Emotion 98.3 12, Wave 103 16 faixas), seguidas das playlists do usuário.
  - **RF-002**: DEVE procurar cada faixa das rádios no YouTube por "Artista - Música"; faixas feitas para o jogo levam " GTA Vice City" na busca.
  - `findStation` acha uma rádio pelo id.

### Playlists do usuário (`createPlaylist`, `addLink`…)

As operações do hook sobre $minhas_playlists.

- **Comportamento:**
  - `createPlaylist` cria com nome de até 40 caracteres (vazio vira "Playlist N") e seleciona a nova playlist.
  - `renamePlaylist` troca o nome. `deletePlaylist` apaga e, se a playlist estiver tocando, para a música.
  - `addLink` devolve o problema em texto ou nada. Só aceita links nas playlists do usuário ("Só dá para adicionar links às suas playlists"), até 500 músicas ("Limite de 500 músicas por playlist").
  - `removeTrack` tira a faixa pelo índice.

### yt-dlp no Rust (`music.rs`)

O `Music` acha, instala e roda o yt-dlp, e guarda os caches da sessão.

- **Comportamento:**
  - **RF-003**: DEVE tocar só o áudio do vídeo, sem salvar arquivos de mídia.
  - **RF-007**: DEVE usar a cópia própria do yt-dlp, se existir, senão a primeira no `PATH`; e DEVE poder baixá-la/atualizá-la, verificando o SHA-256.
  - **RF-008**: DEVE aceitar só streams `https://*.googlevideo.com`.
  - Rode o yt-dlp com argumentos fixos: `--no-config --no-playlist --no-warnings -f bestaudio[ext=m4a]/bestaudio -j`, com a busca como `ytsearch1:<texto>` ou o link `watch?v=<id>`.
    - Valide o id do vídeo (11 caracteres `[A-Za-z0-9_-]`) e a URL do stream (`https`, em `*.googlevideo.com`, sem `@`).
    - `videoId` tem prioridade sobre `query`. Sem nenhum dos dois, responda "Nada para tocar".
  - Guarde a busca → id do vídeo e o stream em cache, e reuse o stream enquanto ele estiver longe de expirar.
  - Se o yt-dlp demorar mais de 40 s, responda "O YouTube demorou demais para responder".
  - `install` baixa o SHA2-256SUMS de `releases/latest` e o executável numa thread própria, com os eventos de progresso e de fim.
    - Se já houver uma instalação em andamento, responda "O yt-dlp já está sendo baixado".
  - `status` diz se o yt-dlp está `missing`, `ready` ou `installing`, a versão (`yt-dlp --version`) e se é a cópia própria (`managed`).
    - A versão fica em cache até o executável mudar (caminho e data de modificação): o `--version` sobe um programa PyInstaller inteiro, ~1 s de CPU, e rodava a cada abertura do player.

### Download verificado (`download.rs`)

- **Comportamento:**
  - `fetch_verified` baixa para um arquivo `.part`, confere o SHA-256 e só então renomeia. O progresso sai a cada 200 ms.
  - Se a soma não bater, responda "Arquivo corrompido (verificação SHA-256 falhou)" e apague o arquivo parcial.
  - `fetch_text` baixa a lista de somas.

## Voz e teclado

- **RF-009**: DEVE responder aos comandos de voz `voice:music` e aos comandos da Busca, e o JARVIS DEVE poder tocar e pausar por `jvos_run`.
  - `App.onMusic` trata `voice:music`, confirma na dock e confirma em voz (`musicNext`, `musicStation`, `musicNotFound`…). A janela não abre por isso.
- Voz:
  - `window:music` — "jv tape", "tape", "player", "player de música", "tocador" (+ verbo abrir/fechar): abre ou fecha a janela.
  - `music:resume` — "dá play", "play", "continua a música", "volta a tocar", "retoma a música", "despausa", "solta o som"…: `resume` → "Tocando".
  - `music:pause` — "pausa", "pausa a música", "para a música", "pare a música", "para o som", "stop music"…: `pause` → "Música pausada".
  - `music:next` — "próxima música", "próxima faixa", "pula a música", "pula essa música", "next song"…: `next` → "Próxima música".
  - `music:previous` — "música anterior", "faixa anterior", "volta a música", "volta para a música anterior", "previous song"…: `prev` → "Música anterior".
  - `music:nextPlaylist` — "próxima playlist", "muda a playlist", "troca de rádio", "próxima estação"…: `stepPlaylist(1)` → `Tocando <nome>`.
  - `music:previousPlaylist` — "playlist anterior", "rádio anterior", "estação anterior": `stepPlaylist(-1)`.
    - "Muda a playlist" pula playlists vazias. Sem nenhuma com músicas, diga "Nenhuma playlist com músicas".
  - `music:play` (verbos "toca", "tocar", "toque", "coloca", "bota", "põe", "tocando"…) + nome: `playNamed(nome)`; sem nome, `resume`.
    - `playNamed` toca a playlist desde a primeira música, ou de uma aleatória com o aleatório ligado. Se o nome não existir, diga `Não achei a playlist “<nome>”` e não mude nada.
  - As listas completas de frases estão em `src-tauri/voice-commands.json`; o casamento do nome falado é descrito no [Fluxo](#fluxo).
- Busca (`/`), em `src/lib/commands.ts`: `Tocar <playlist>` abre o player e toca desde a primeira música; "Pausar a música"/"Retomar a música" e "Próxima música" comandam o player.
- Teclado, com o foco no player:
  - ↑ / ↓: cursor nas faixas.
  - ← / →: playlist anterior / próxima (só mostra, não toca).
  - Enter · duplo clique: toca a faixa do cursor.
  - Espaço: tocar / pausar.
  - `n` / `b`: próxima / anterior.
  - `,` / `.`: −10 s / +10 s.
  - `-` / `+` ou `=`: volume −5% / +5%.
  - `s`: aleatório.
  - `p`: nova playlist.
  - `a`: foca o campo de link (playlist do usuário).
  - Delete: remove a faixa do cursor (playlist do usuário).
  - Esc no campo de link: volta o foco ao player.

## Restrições

- **RNF-001**: Busca do yt-dlp com tempo-limite de 40 s; `--version` com 20 s.
- **RNF-002**: Streams ficam em cache até 120 s antes de expirarem (`expire=` da URL); busca → id do vídeo em cache na sessão.
- **RNF-003**: Busca de 1 a 200 caracteres, espaços normalizados.
- **RNF-004**: Executável até 64 MiB; lista de somas até 64 KiB; progresso a cada 200 ms.
- **RNF-005**: A fita gira a cada 125 ms só enquanto toca, com a janela visível e sem "movimento reduzido".
- Cada playlist do usuário tem nome de até 40 caracteres e até 500 faixas.

## Critérios de sucesso

- **SC-001**: Uma rádio começa a tocar com uma tecla (Enter) ou uma frase ("toca a Flash FM").
- **SC-002**: A música nunca para ao fechar a janela do player.
- **SC-003**: Playlists do usuário sobrevivem a recarregar o app, sem perder faixas válidas.

## Entregáveis

O hook `useMusicPlayer`, instanciado uma vez em `App.tsx`, guarda um único `HTMLAudioElement` e todo o estado de reprodução; a janela, os widgets, a barra superior, a Busca e a voz recebem o mesmo objeto `MusicPlayer`. Na hora de tocar, o Rust roda o yt-dlp (`music_resolve`) para achar o vídeo e devolver a URL assinada do stream só de áudio, e a WebView toca essa URL direto (a CSP libera `https://*.googlevideo.com` em `media-src`). O yt-dlp é o do `PATH` ou uma cópia própria baixada do GitHub e conferida por SHA-256.

| | |
|---|---|
| **Camadas** | UI React (`TapePlayer`, `musicParts`) · hook (`useMusicPlayer`, `useTapeTick`) · lib (`src/lib/music/*`) · comandos `music_*` · módulos Rust `music.rs` e `download.rs` |
| **Dependências** | ver [Dependências](#dependências) |
| **Testes** | `tests/music.spec.ts` (com `standInMusic` de `tests/helpers.ts`); Rust `mod tests` em `music.rs`, `download.rs` e `voice/matcher.rs` |
| **Plataforma** | Windows 11 · WebView2. Fora do Tauri: fake `window.__JARVIS_MUSIC__` (só em DEV; o teste gera um WAV mudo); sem ele, erro "Disponível no app desktop" |

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/desktop/apps/TapePlayer.tsx` | Janela: rádios e "Minhas playlists", faixas, campo de link, fita, "Tocando agora", dicas de teclas, pedido do yt-dlp |
| `src/components/desktop/musicParts.tsx` | Peças comuns com os widgets: `clock`, `nowLabel`, `ProgressBar`, `musicKeys`, `TAPE_MAGENTA` |
| `src/hooks/useMusicPlayer.ts` | Player app-wide: áudio único, reprodução, avanço, aleatório, falhas, playlists, yt-dlp, persistência |
| `src/hooks/useTapeTick.ts` | Passo da animação da fita (125 ms) |
| `src/lib/music/stations.ts` | As 7 rádios (`STATIONS`), `searchQuery`, `findStation` |
| `src/lib/music/match.ts` | `matchPlaylist`: nome falado → playlist |
| `src/lib/music/youtube.ts` | `parseYoutubeId`, `splitVideoTitle` |
| `src/lib/music/cassette.ts` | A fita em texto (48 colunas), carretéis e fita andando com o progresso |
| `src/lib/commands.ts` | Busca: `Tocar <playlist>`, "Pausar a música"/"Retomar a música", "Próxima música" |
| `src/App.tsx` | `useMusicPlayer({ onTrackStart: audio.pulse })`; `onMusic` trata `voice:music` e confirma na dock e em voz |
| `src-tauri/src/music.rs` | `Music`: localizar, instalar e rodar o yt-dlp; caches; validação do stream |
| `src-tauri/src/download.rs` | `fetch_verified` (arquivo `.part`, SHA-256, renomeia no fim) e `fetch_text` |
| `src-tauri/tauri.conf.json` | CSP `media-src 'self' blob: mediastream: https://*.googlevideo.com` |

### Contratos

#### Comandos Tauri

| Comando | Entrada | Saída | Notas |
|---|---|---|---|
| `music_status` | — | `{ ytdlp: "missing" \| "ready" \| "installing", version, managed }` | `version` vem de `yt-dlp --version` |
| `music_install` | — | — (assíncrono) | Thread própria; resultado pelos eventos |
| `music_resolve` | `query?` ou `videoId?` | `{ videoId, title, uploader, duration, url }` | `videoId` tem prioridade; sem nenhum: "Nada para tocar"; sem yt-dlp: erro sentinela `yt-dlp-missing` |

#### Eventos e Channels

| Nome | Payload | Emissor → consumidor |
|---|---|---|
| `music:install-progress` | `{ id: "yt-dlp", received, total }` | `music_install` → `useMusicPlayer` (barra) |
| `music:install-done` | `{ version, error }` | `music_install` → `useMusicPlayer` (toca o pedido pendente) |
| `voice:music` | `{ action, target }` | motor de voz → `App.onMusic` |

#### Ferramentas MCP (JARVIS)

| Tool | O que faz |
|---|---|
| `jvos_run` | Roda os comandos da Busca, entre eles `Tocar <playlist>`, pausar/retomar e próxima música |

### Fluxo

```mermaid
sequenceDiagram
  participant U as Usuário
  participant UI as TapePlayer / voz / Busca
  participant H as useMusicPlayer
  participant R as Rust music.rs
  participant Y as yt-dlp
  participant A as Elemento audio
  U->>UI: Enter / "toca a Flash FM"
  UI->>H: play(station, index) / playNamed(nome)
  H->>R: invoke("music_resolve", {query | videoId})
  alt em cache e longe de expirar
    R-->>H: Resolved
  else
    R->>Y: --no-config --no-playlist --no-warnings -f bestaudio[ext=m4a]/bestaudio -j ytsearch1:… | watch?v=…
    Y-->>R: JSON
    R->>R: valida id e URL googlevideo; guarda caches
    R-->>H: Resolved
  end
  H->>A: src = url; play()
  A-->>H: playing / timeupdate / ended
  H->>R: music_resolve(próxima) para aquecer
  A-->>H: ended → próxima faixa
```

Nome falado → playlist: o matcher Rust reconhece o verbo de tocar e descarta palavras de enchimento ("a", "o", "da", "pra", "playlist", "radio", "estacao", "musica"…); a UI compara com `matchPlaylist`, que normaliza, ignora palavras genéricas ("fm", "radio", "playlist", "the", "de", "da", "do", "a", "o") e números, tolera uma letra de diferença em palavras de 5+ letras, compara também o nome sem espaços ("wildstyle" / "wild style") e escolhe a maior fração de palavras ouvidas, depois o casamento mais longo.

### Testes

- `npx playwright test tests/music.spec.ts --project ui`: rádios e fita, playlists de links, widgets com a janela fechada, voz e Busca, com o fake `standInMusic` (critérios 1–21).
- `cargo test --lib music::` (em `src-tauri`): soma do SHA2-256SUMS, `parse_resolved` (id e URL `googlevideo`), busca normalizada e limitada, link sem id válido e erros do yt-dlp (RF-003, RF-007, RF-008, RNF-003).
- `cargo test --lib music:: -- --ignored` (em `src-tauri`, com rede): baixa o yt-dlp numa pasta temporária e resolve uma música de verdade, com cache (critério 23 no backend real).
- `cargo test --lib download::` (em `src-tauri`): o hex do SHA-256 do download verificado.
- `cargo test --lib -- controls_the_music plays_pauses_and_goes_back_in_few_words` (em `src-tauri`): frases `music:*`, verbos de tocar com nome e "abre o player" (critérios 14–17 e 19 no matcher).
- Sem teste automatizado: o pedido "Baixar o yt-dlp" e "atualizar yt-dlp" na UI (critérios 22 e 24).

### Reversão

- Tirar só a janela: o kind `music` de `src/lib/desktop.ts` (`WindowKind`, `WINDOW_KINDS`, `WINDOW_SPECS`), de `WINDOW_KEYWORDS`/`APP_SUBTITLES` e do `openWindow("music")` de `Tocar <playlist>` em `commands.ts`, o `case "music"` de `Desktop.tsx` e o `TapePlayer` de `lazyApps.tsx`; `window:music` de `src-tauri/voice-commands.json`, `"music"` do `WINDOW_KINDS` de `settings.rs` e os asserts de `window("music", …)` em `voice/matcher.rs`.
- **Não** dá para tirar `useMusicPlayer` sozinho: os widgets [Fita](../../widgets/tape/spec.md) e [Mini player](../../widgets/miniplayer/spec.md), a barra superior, a Busca e `onMusic` usam o mesmo player. Tirar o player inteiro leva junto os `music:*` do catálogo de voz, `MUSIC_TARGETS` de `settings.rs`, os comandos `music_*`, `music.rs`, o `googlevideo` da CSP e `music` do `testMatch`.
- `download.rs` fica: os downloads de modelos (`models.rs`, `speech.rs`) usam o mesmo `fetch_verified`.
- Fica órfão e é ignorado: `jarvis.music` e `jarvis.music.playlists` no localStorage, a janela `music` em `jarvis.desktop` (`parseDesktop` descarta kinds desconhecidos), os comandos de voz gravados no `settings.json` (descartados ao carregar) e `%LOCALAPPDATA%\dev.jarvis.os\bin\yt-dlp.exe`.

### Constituição

- [x] P1 Offline-first — a rede só é usada para o YouTube (online por natureza) e para baixar o yt-dlp do GitHub; nenhuma chave de API.
- [x] P2 Rust é dono do nativo — o processo yt-dlp e o download ficam no Rust; a WebView só toca a URL, e a CSP só libera `googlevideo.com` para mídia.
- [x] P3 Comandos finos — `music_status`, `music_install`, `music_resolve` repassam para `music::Music` (`spawn_blocking` ou thread própria no `music_install`); eventos `music:install-progress` e `music:install-done`.
- [ ] P4 Contratos espelhados — `Resolved` e o retorno de `music_status` são declarados no hook sem o comentário `Mirrors`; o `Resolved` do TypeScript não tem `videoId`, que o Rust envia.
- [x] P5 Persistência tolerante — `parsePrefs` e `parsePlaylists` validam campo a campo (ids `pl-…`, `videoId` revalidado por `parseYoutubeId`, textos cortados) e caem no padrão.
- [x] P6 Fora do Tauri — fake de DEV `__JARVIS_MUSIC__`; sem ele, "Disponível no app desktop".
- [x] P7 PT-BR na UI — rótulos, erros do Rust e frases de voz em PT-BR.
- [ ] P8 Linguagem visual — usa os tokens `hud-*` e o kit TUI (`BlockBar`, `KeyHint`), mas a barra de progresso usa a cor fixa `TAPE_MAGENTA` (`oklch(0.68 0.21 330)`), "como no youtube-music-cli".
- [x] P9 Desktop leve — app lazy; a fita só anima tocando e com o app visível (`paused`), e para com "movimento reduzido"; o relógio da música fica fora do estado React (`useSyncExternalStore`).
- [x] P10 Confinamento — argumentos fixos do yt-dlp com `--no-config`; a busca vai como `ytsearch1:<texto>` (nunca vira opção ou URL); o id do vídeo é validado (11 caracteres `[A-Za-z0-9_-]`); a URL do stream tem de ser `https` em `*.googlevideo.com` e sem `@`; o binário só é usado com o SHA-256 conferido.
- [ ] P11 Testes — `music.spec` está no `testMatch` do projeto `ui`; o teste de rede `installs_and_resolves_for_real` usa `#[ignore]` sem motivo.
- [x] P12 README mínimo.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como shell desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0004 — catálogo de voz compartilhado e fallback](../../arch/adr/0004-catalogo-de-voz-compartilhado-e-fallback.md)
- [ADR-0010 — settings.json vs localStorage](../../arch/adr/0010-persistencia-settings-vs-localstorage.md)
- [ADR-0011 — fakes de dev e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0012 — apps lazy com preload](../../arch/adr/0012-apps-lazy-com-preload.md)
- [ADR-0014 — linguagem visual TUI](../../arch/adr/0014-linguagem-visual-tui.md)
- Persistência: [persistence.md](../../domain/persistence.md) · Intents de voz: [voice-intents.md](../../domain/voice-intents.md) · Segurança: [security.md](../../arch/security.md)

## Dependências

- **Vendor:** [Tauri](../../foundation/vendor/tauri/spec.md), [React](../../foundation/vendor/react/spec.md), [motion](../../foundation/vendor/motion/spec.md) (`useReducedMotion` na fita), [serde](../../foundation/vendor/serde/spec.md), [HTTP](../../foundation/vendor/http/spec.md) (`ureq` 3 no download), [archives](../../foundation/vendor/archives/spec.md) (`sha2` 0.10), [yt-dlp](../../foundation/vendor/yt-dlp/spec.md) (processo externo)
- **Specs:** [desktop-windows](../../features/desktop-windows/spec.md) (janela e app lazy), [voice-commands](../../features/voice-commands/spec.md) (`window:music`, `music:*` e verbos de tocar), [search](../../features/search/spec.md) (`Tocar <playlist>`, pausar e próxima), [dock-taskbar](../../features/dock-taskbar/spec.md) (aviso na dock), [tts](../../features/tts/spec.md) (confirmação falada), [assistant-tools](../../features/assistant-tools/spec.md) (`jvos_run`)
- **Sistema:** WebView2 (elemento `<audio>`); rede: YouTube (streams `*.googlevideo.com`) e GitHub (`releases/latest` do yt-dlp); yt-dlp no `PATH` ou a cópia própria em `%LOCALAPPDATA%\dev.jarvis.os\bin\`.

## Tarefas

Legenda: `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código, do commit de origem `42e671a` e das mudanças do `e7151cf` (confirmação falada).

### Fase 1 — Base

- [x] T001 Tipos `Station`/`Track`, as 7 rádios do Vice City e `searchQuery` (faixas do jogo com " GTA Vice City") — `src/lib/music/stations.ts`
- [x] T002 [P] `parseYoutubeId` e `splitVideoTitle` (tira "(Official Video)", " - Topic", "VEVO") — `src/lib/music/youtube.ts`
- [x] T003 [P] `fetch_verified` (`.part`, SHA-256, limite, progresso a cada 200 ms) e `fetch_text` — `src-tauri/src/download.rs`
- [x] T004 `Music`: executável próprio ou do `PATH`, `status`, `install` (SHA2-256SUMS de `releases/latest`), `resolve`/`resolve_video`, caches e `parse_resolved` — `src-tauri/src/music.rs`
- [x] T005 Comandos `music_status/install/resolve` e eventos `music:install-progress`/`music:install-done` — `src-tauri/src/lib.rs`
- [x] T006 [P] CSP `media-src … https://*.googlevideo.com` — `src-tauri/tauri.conf.json`

### Fase 2 — US1 Tocar uma rádio (P1)

- [x] T007 [US1] `useMusicPlayer`: áudio único, `play`, `toggle`, `next`/`prev` (reinicia após 3 s), `seek`/`seekTo`, volume, aleatório, avanço no `ended`, pulo após 3 s até 3 falhas, aquecimento da próxima busca — `src/hooks/useMusicPlayer.ts`
- [x] T008 [US1] Relógio fora do React (`createClock`, `useMusicTime`) — `src/hooks/useMusicPlayer.ts`
- [x] T009 [US1] Fita em texto e animação de 125 ms — `src/lib/music/cassette.ts`, `src/hooks/useTapeTick.ts`
- [x] T010 [US1] Janela `TapePlayer`: listas, "Tocando agora", barra de progresso, dicas de teclas e atalhos de uma tecla — `src/components/desktop/apps/TapePlayer.tsx`, `src/components/desktop/musicParts.tsx`
- [x] T011 [US1] Persistência `jarvis.music` com `parsePrefs` — `src/hooks/useMusicPlayer.ts`

### Fase 3 — US2 Minhas playlists (P1)

- [x] T012 [US2] `createPlaylist`, `renamePlaylist`, `deletePlaylist` (para a música dela), `addLink` com mensagens de erro, `removeTrack` — `src/hooks/useMusicPlayer.ts`
- [x] T013 [US2] Título e artista do vídeo via `music_resolve` + `splitVideoTitle` — `src/hooks/useMusicPlayer.ts`
- [x] T014 [US2] Campo de nome, campo "Link do YouTube", "renomear", "apagar" com "[s] sim"/"[n] não" — `src/components/desktop/apps/TapePlayer.tsx`
- [x] T015 [US2] Persistência `jarvis.music.playlists` com `parsePlaylists` — `src/hooks/useMusicPlayer.ts`

### Fase 4 — US3 Música fora da janela (P1)

- [x] T016 [US3] Player instanciado uma vez em `App.tsx` e repassado à janela e aos widgets — `src/App.tsx`, `src/components/desktop/Desktop.tsx`

### Fase 5 — US4/US5 Voz e Busca (P2)

- [x] T017 [US4] Frases `window:music` e `music:*` — `src-tauri/voice-commands.json`
- [x] T018 [US4] `matchPlaylist` (palavras distintivas, uma letra de tolerância, nome junto) e `playNamed`/`stepPlaylist` — `src/lib/music/match.ts`, `src/hooks/useMusicPlayer.ts`
- [x] T019 [US4] `onMusic` com aviso na dock — `src/App.tsx`
- [x] T020 [US4] Confirmação falada (`musicNext`, `musicStation`, `musicNotFound`…) — `src/lib/jarvisLines.ts`, `src/App.tsx` (`e7151cf`)
- [x] T021 [US5] Comandos da Busca `Tocar <playlist>`, pausar/retomar e próxima — `src/lib/commands.ts`

### Fase 6 — US6 Instalar o yt-dlp (P2)

- [x] T022 [US6] Erro sentinela `yt-dlp-missing`, pedido "Baixar o yt-dlp", progresso e retomada da música pendente; "atualizar yt-dlp" — `src/hooks/useMusicPlayer.ts`, `src/components/desktop/apps/TapePlayer.tsx`

### Fase 7 — Testes

- [x] T023 Playwright `tests/music.spec.ts` — "jv_T4p3 lists the Vice City stations and plays one, with the cassette turning"
- [x] T024 Playwright — "playlists of YouTube links are created, edited, kept and played"
- [x] T025 Playwright — "the Fita and Mini player widgets follow the music, which goes on with the player closed"
- [x] T026 Playwright — "voice plays playlists, skips, pauses and opens or closes the player and its widgets"
- [x] T027 Playwright — "the search plays a station and opens the player"
- [x] T028 Fake `standInMusic` (WAV mudo em `__JARVIS_MUSIC__`) — `tests/helpers.ts`
- [x] T029 Rust `src-tauri/src/music.rs` — `finds_the_checksum_of_a_file`, `parses_a_resolution`, `rejects_odd_resolutions`, `queries_are_normalised_and_bounded`, `pasted_links_need_a_real_video_id`, `error_lines_lose_their_prefix`; ignorado (rede): `installs_and_resolves_for_real`
- [x] T030 Rust `src-tauri/src/download.rs` — `hex_is_lowercase_and_padded`
- [x] T031 Rust `src-tauri/src/voice/matcher.rs` — `controls_the_music`, `plays_pauses_and_goes_back_in_few_words`

## Pendências

- [ ] A versão do yt-dlp não é fixada: `install` baixa sempre `releases/latest`, e o SHA2-256SUMS vem da mesma release — `src-tauri/src/music.rs` (`RELEASES`)
- [ ] Cor fixa `TAPE_MAGENTA` fora dos tokens `hud-*` (P8) — `src/components/desktop/musicParts.tsx`
- [ ] `Resolved` e o retorno de `music_status` no TypeScript não têm `Mirrors` e o `Resolved` omite `videoId` (P4) — `src/hooks/useMusicPlayer.ts`
- [ ] `installs_and_resolves_for_real` usa `#[ignore]` sem o motivo exigido por P11 — `src-tauri/src/music.rs`
- [ ] Os caches `ids` e `streams` do `Music` não têm limite nem limpeza durante a sessão — `src-tauri/src/music.rs`
- [ ] Na confirmação "apagar “<nome>”?", os rótulos "[s] sim" e "[n] não" sugerem teclas, mas `s` liga o aleatório e `n` pula a música, porque o mapa de teclas do player continua ativo — `src/components/desktop/apps/TapePlayer.tsx` (`onKeyDown`)
