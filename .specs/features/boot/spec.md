# Tela de inicialização (BIOS)

A abertura do jvOS: o POST de uma BIOS antiga num monitor CRT, que termina no emblema do JARVIS e passa a vez ao holograma.

| | |
|---|---|
| **ID** | `feature/boot` |
| **Status** | Implementado |
| **Origem** | `42e671a` (2026-10-23) · evoluída em `c4ccc57` e não commitado (27/10) |

## Visão geral

Ao abrir, o JARVIS faz o POST de uma BIOS antiga num monitor CRT, com scanlines, brilho de fósforo, flicker e a fonte VT323. A sequência mostra o banner, a contagem de memória e os dispositivos respondendo um a um. Depois vêm o bipe, uma tela de resumo com a listagem PCI e, por fim, a "máquina ganhando vida": um acorde, o emblema de anéis e "Bem-vindo", que se dissolvem no desktop. Em seguida o núcleo liga e o JARVIS cumprimenta (ver [saudação](../../features/greeting-homecoming/spec.md)).

É a abertura do jvOS. Qualquer tecla ou clique pula a tela. Delete pula direto para as Configurações, como o SETUP de uma BIOS. A tela pode ser desligada e revista pelo Menu avançado ou pela busca.

## Dados

- `$prefs`: **BootPrefs** `{ enabled: boolean, sound: boolean }`, padrão `{true, true}`. Fica em `jarvis.boot` (localStorage, via `useStoredState`), com debounce de 250 ms e flush no `beforeunload`. É lido de forma síncrona, para valer desde o primeiro quadro. Ver [persistência](../../domain/persistence.md).
  - **RF-006**: O sistema DEVE guardar `jarvis.boot` = `{enabled, sound}`, com padrão `true`/`true`. Um valor inválido volta ao padrão campo a campo.
  - `parseBoot` valida cada campo sozinho: um `enabled` que não é booleano volta a `true` sem mexer em `sound`, e vice-versa.
- `$info`: **BootInfo**, o que o POST diz do JARVIS (versão, qualidade, voz, ativação, tema, módulos, janelas). Montado por `describeBoot` a cada render, só em memória.
- `$sonda`: **SystemProbe**, o que o POST diz da máquina (CPU, GPU, tela, memória, áudio). Lido uma vez por `probeSystem` quando a tela monta.
- `$roteiro`: a lista de linhas do POST com o instante de cada uma, calculada uma vez por `buildScript($info, $sonda)`. Traz também `printed` (tudo na tela), `clearAt` (o bipe e a troca de tela) e o BIOS ID.

## Componentes

### `BootSequence`

A tela inteira: o tubo CRT, o relógio que avança $roteiro, as duas telas do POST e a tela de partida.

- **Comportamento:**
  - **RF-001**: A tela DEVE ser uma função do tempo decorrido: 70 ms por linha, 240 ms entre o nome de um dispositivo e a resposta dele, contagem de memória em 700 ms e glitch de 140 ms na troca de tela.
  - Um laço `requestAnimationFrame` só avança o relógio. Os sons disparam quando o relógio passa pelos instantes deles: o bipe em `clearAt` e o acorde 250 ms depois do início da tela de partida.
  - Comece a "digitar" só quando o núcleo avisar o primeiro quadro (`started`) e a fonte VT323 estiver carregada.
  - Se a fonte VT323 ou o primeiro quadro não chegarem, então o POST começa mesmo assim após 1,5 s (`START_FALLBACK_MS`).
  - Se um quadro travar, então ele avança a linha do tempo no máximo 100 ms (`MAX_STEP_MS`). A sequência desacelera em vez de pular fases.
  - Se o usuário pedir movimento reduzido, então tudo é impresso de uma vez e fica 1100 ms na tela (`REDUCED_HOLD`) antes do "Bem-vindo". Não há ligar do CRT nem glitch.
  - Um pulo (tecla ou clique) vai direto ao fade de saída de 0,6 s. Ao fim do fade, chame `onDone(openSettings)`.
  - O laço para quando a tela sai. Um leitor de tela ouve "Inicializando o sistema. Qualquer tecla pula; Delete abre as configurações." (`role="status"`).
- **Layout:**
  - `data-testid="boot"` cobre a janela (`fixed inset-0 z-[60]`) sobre fundo preto.
  - Dentro, o tubo (`crt-screen`) fica a `1.4vh` das bordas, com cantos `rounded-[2.2vw]`. Por cima do texto ficam as camadas `crt-scanlines`, `crt-mask`, `crt-noise`, a faixa `crt-roll` (`24vh` de altura) e o vidro `crt-glass`.
  - O `crt-noise` é maior que a tela 64 px de cada lado e salta movendo a própria camada (`transform`, no compositor), não repintando o fundo (`background-position`, que repintava a tela inteira 11 vezes por segundo).
  - O relógio do boot checa os sons a cada quadro, mas re-renderiza a tela no máximo a cada 32 ms (~30 fps), o bastante para o texto digitado.
  - O texto tem margem `px-[5vw]`, `pt-[5.5vh]` e `pb-[9vh]`. Só uma tela fica visível por vez: as linhas antes de `clearAt` na primeira, as de depois na segunda.
- **Estilo:**
  - Fonte `font-bios` (VT323, `--font-bios`) em `clamp(15px, 2.8vh, 34px)`, `leading-[1.2]`, cor `text-hud-text`, com `crt-text` (brilho de fósforo e aberração cromática) e `crt-flicker`. Na troca de tela, `crt-glitch` alarga a aberração por 140 ms.
  - O tubo liga em 0,5 s como um CRT: um ponto, uma linha, a tela inteira, com o brilho caindo de `brightness(3)` para 1 (`CRT_ON`).
  - A saída é só um fade de 0,6 s, um pouco mais claro (`brightness(1.15)`), com a escala mantida em 1 (`SCREEN_OUT`): o tubo não "desliga".
  - Na tela de partida, o texto some em 300 ms e a textura do tubo em 700 ms.
  - O cursor é um `_` piscante (`crt-cursor`) em `text-hud-light`, depois da última linha.

### Primeira tela (POST)

O banner, o processador, a contagem de memória e os dispositivos respondendo um a um.

- **Comportamento:**
  - Imprima, nesta ordem: "BIOS Modular v<versão>, Núcleo Holográfico"; "Copyright (C) <ano>, Assistente Local. Nenhum dado sai desta máquina."; "Processador principal"; "Teste de memória" contando de 0 até `<K>K OK` em 700 ms; "Detectando dispositivos..." e, um por vez, Vídeo primário, Tela, Áudio e Motor de voz.
  - Cada dispositivo mostra o nome e só 240 ms depois a resposta.
  - O Áudio responde "Web Audio API" ou, sem `AudioContext`, "Nenhum" em cor de alerta.
  - O rodapé diz "Pressione DEL para entrar no SETUP, qualquer tecla para pular" e mostra o BIOS ID `JV-HOLO-<dígitos da versão>-<id da GPU><vendor>-00`.
  - A tela não tem logo, nome JARVIS, data/hora nem SVG.
- **Layout:**
  - Uma linha por item (`TerminalLine`), com os dois-pontos alinhados na coluna 22 (`LABEL_WIDTH`). Os dispositivos ficam recuados dois espaços.
  - Uma linha vazia de `0.6em` separa o banner, o processador e a memória, e a detecção.
  - O rodapé fica no canto inferior (`bottom-[4vh]`, entre `5vw` de cada lado), em duas linhas: a dica e o BIOS ID.
- **Estilo:**
  - O banner fica em `text-hud-light`; o copyright em `text-hud-text/55`.
  - As respostas ficam em `text-hud-light` (ok), `text-hud-alert` (aviso) ou `text-hud-text/45` (não se aplica), e são cortadas com reticências se não couberem.
  - O rodapé fica em `text-hud-text/70`, com "DEL" em `text-hud-light` e o BIOS ID em `text-hud-text/55`.

### Segunda tela (resumo e PCI)

Depois do bipe, o resumo da configuração, a listagem PCI e a passagem para o núcleo.

- **Comportamento:**
  - **RF-002**: A caixa de resumo DEVE ter 10 campos em duas colunas: Processador, Motor de voz, Memória, Ativação, Vídeo, Tema, Tela, Widgets e apps ("<n> módulos", com n = `WINDOW_KINDS.length`), Perfil gráfico (nível de qualidade em maiúsculas) e Sessão.
  - **RF-003**: O vendor PCI DEVE vir do nome da GPU (NVIDIA `10DE`, AMD `1002`, Intel `8086`, Apple `106B`, Qualcomm `5143`, SwiftShader/Google `1AE0`, outros `1414`). Os IDs de dispositivo vêm de um hash estável do nome.
  - Depois da caixa, imprima "Listagem de dispositivos PCI...", o cabeçalho "Barr.", "Disp.", "Func.", "Fornec.", "Disp.", "Classe", "Descrição do dispositivo", "IRQ", um traço e as linhas "Controlador de vídeo" (classe `0300`, IRQ 16), "Controlador de áudio" (classe `0403`, IRQ 11, só com áudio) e "Controlador ACPI" (IRQ 9).
    - O áudio usa o vendor `1022` quando a GPU é AMD e `8086` nos outros casos.
  - Em seguida, "Verificando dados do pool DMI " ganha 12 pontos em 600 ms, e a última linha é "Iniciando o núcleo holográfico...".
- **Layout:**
  - A caixa é um `fieldset` de até `100ch`, com a legenda "Configuração do sistema" centrada no topo e uma grade de duas colunas. Os dois-pontos ficam na coluna 15 (`SUMMARY_LABEL_WIDTH`).
  - A tabela PCI usa colunas de largura fixa (6, 6, 6, 8, 6, 7, 30 e 3 caracteres); a última coluna, o IRQ, é alinhada à direita.
- **Estilo:**
  - A caixa e o divisor entre as colunas usam uma borda dupla de 3 px em `hud-text/70`; a legenda fica em `text-hud-light`.
  - Os valores usam as mesmas cores da primeira tela (ok, aviso, não se aplica).

### Sonda (`probeSystem` e `describeBoot`)

Monta $sonda e $info, que as duas telas mostram.

- **Comportamento:**
  - O processador é "<n> núcleos lógicos" (`navigator.hardwareConcurrency`, 4 sem o valor). A tela é "<largura> × <altura> @ <escala>x".
  - O nome da GPU vem do renderer WebGL, sem o invólucro do ANGLE, e é cortado em 46 caracteres.
  - O tema mostra o nome da paleta ou "Personalizada <matiz>°".
  - Se não houver WebGL, então o vídeo aparece como "sem WebGL" e o vendor PCI cai em `1414`.
  - Se o Chromium limitar `navigator.deviceMemory` a 8 GB, então a memória mostra 8 GB. Sem o valor, a conta usa 8 GB.
  - Se os settings ainda não tiverem carregado, então Ativação e Tema mostram "…", e o motor de voz mostra "verificando…".
  - Se o modelo Whisper não estiver baixado, então o motor de voz mostra "Whisper <rótulo> · não baixado", em cor de alerta.
  - Se estiver no modo navegador, então o motor de voz mostra "modo navegador · só visual".
  - A Sessão mostra "N janela(s) restaurada(s)" ou "área de trabalho limpa", conforme `jarvis.desktop`.

### `Startup`

A "máquina ganhando vida" depois do POST: o emblema de anéis e "Bem-vindo".

- **Comportamento:**
  - **RF-004**: Depois do POST, a tela de partida DEVE durar 2100 ms, com o acorde e o emblema 250 ms após o início dela.
  - "Bem-vindo" entra 350 ms depois do emblema.
  - Um pulo antes do fim do POST vai direto ao fade de saída, sem passar por esta tela.
- **Layout:** `data-testid="boot-startup"` centraliza, numa coluna com espaço de `3.2vh`, o emblema `Rings` (`20vh`) e o texto "Bem-vindo" embaixo.
- **Estilo:**
  - Um brilho radial de `hud-cyan` a 16%, centrado um pouco acima do meio, aparece em 0,9 s.
  - O emblema e o texto ficam em `text-hud-light`. Cada um entra em 0,8 s de `opacity 0`, `scale 0.94` e `blur(6px)`; com movimento reduzido, só a opacidade, em 0,3 s.
  - `Rings` é um SVG em `currentColor`: dois arcos girando em 9 s, um anel tracejado girando ao contrário em 5 s, um anel fixo e um ponto central, com sombra `hud-holo` a 60%.
  - "Bem-vindo" usa `font-sans` leve em `clamp(16px, 2.6vh, 30px)`, com `tracking-[0.08em]`.

### Sons (`createBootSound`)

O bipe, o acorde e os efeitos da saudação, sintetizados.

- **Comportamento:**
  - **RF-009**: Os sons DEVEM ser sintetizados com Web Audio, sem arquivos: o bipe (onda quadrada de 1000 Hz, ~150 ms) e o acorde (A, E, B, C#, E por 3,2 s).
  - **RF-010**: A preferência `sound` DEVE valer também para os impactos e glitches da saudação e do `JarvisReply`.
  - Com `sound` desligado, ou sem Web Audio, use o objeto `SILENT`: todos os sons são vazios.
  - Se não houver gesto do usuário no navegador, então o `AudioContext` fica suspenso e os sons não tocam.
  - `close()` fecha o contexto com atraso, para o acorde terminar de soar.

### Orquestração no `App`

Liga o boot ao resto do desktop.

- **Comportamento:**
  - **RF-008**: Durante o boot, o núcleo DEVE ficar em `standby` (apagado), e a dock, a barra superior, o botão do núcleo e o histórico ficam fora. Ao terminar, o núcleo liga com dois pulsos de áudio (no fim e 1,3 s depois).
  - `booting` começa igual a $prefs.enabled. Com o boot desligado, não há boot nem saudação: o núcleo já está ligado.
  - `finishBoot` marca `ignitedAt`, inicia a saudação e, se Delete foi apertado, abre as Configurações.
  - **RF-007**: "Ver agora" e o comando de busca DEVEM rodar o boot de novo, descartando a saudação em curso.
    - `replayBoot` fecha o Menu avançado, descarta a saudação pendente e liga `booting`, mesmo com o boot desligado.
  - O boot roda com qualquer modo de núcleo (3D, 2D ou desligado): o núcleo é sempre desenhado, porque é ele que avisa o primeiro quadro.

### Revelação da janela

A janela do Windows nasce oculta e só aparece quando já há algo desenhado.

- **Comportamento:**
  - Quando o núcleo desenhar o primeiro quadro (`onFirstFrame`), chame `reveal()`: mostre e foque a janela, e marque `firstFrame` para o POST começar.
  - Se esse sinal não chegar, a UI chama `reveal()` após 500 ms (`REVEAL_FALLBACK_MS`), e o Rust mostra e foca a janela após 2,5 s (`REVEAL_FALLBACK`), se ela ainda estiver oculta.
  - Fora do Tauri, `reveal()` não faz nada.

### Seção "Inicialização" do Menu avançado

As preferências do boot, na aba Cores do Menu avançado.

- **Comportamento:**
  - O switch "Tela de inicialização" ("BIOS num monitor CRT ao abrir o JARVIS; qualquer tecla pula") troca $prefs.enabled.
  - O switch "Sons da inicialização" ("Bipe de POST e o acorde ao ligar") troca $prefs.sound.
  - O botão "Ver agora" chama `replayBoot`.
  - Na busca (`/`), "Ver a tela de inicialização" (`boot-replay`) e "Desativar a tela de inicialização" ou "Ativar …" (`boot-toggle`, grupo Sistema) fazem o mesmo.
- **Layout:** uma `Section` "Inicialização", no topo da aba Cores, com dois `SwitchRow` e um `ActionButton`.
- **Estilo:** os controles do kit do Menu avançado, sem estilo próprio.

## Voz e teclado

- **RF-005**: Qualquer tecla sem modificador DEVE pular a tela sem se propagar (captura + `stopImmediatePropagation`). Delete DEVE abrir as Configurações ao fim do fade.
- Qualquer tecla sem Ctrl/Meta/Alt: pula. O listener fica na fase de captura e chama `preventDefault` + `stopImmediatePropagation`, então `M` não liga o microfone.
- `Delete`: pula e abre as Configurações (`onDone(true)`).
- Ctrl, Meta ou Alt: o boot não intercepta o atalho.
- Clique (`pointerdown`) na tela: pula.
- Menu avançado → "Ver agora" / busca "Ver a tela de inicialização": `replayBoot()`.

## Restrições

- **RNF-001**: Nenhum dado sai da máquina. CPU, GPU, tela, memória e áudio vêm de APIs do navegador (`navigator.hardwareConcurrency`, `WEBGL_debug_renderer_info`, `screen`, `deviceMemory`, `AudioContext`).
- **RNF-002**: A fonte VT323 vem empacotada (`@fontsource/vt323`), porque a CSP não permite fontes remotas.
- **RNF-003**: O `AudioContext` fecha 3,5 s depois (`CHIME_SECONDS` + 300 ms), para o acorde terminar de soar.
- `tauri.conf.json`: janela `visible: false`, `backgroundColor: #000508`, `--autoplay-policy=no-user-gesture-required` (o som toca sem gesto no app).

## Histórias de usuário

### US1 — Assistir ao POST ao abrir (P1)

Ao abrir o JARVIS numa instalação nova, vejo a BIOS testar a máquina e passar a vez ao holograma.

**Por que P1:** é a primeira impressão do produto e o momento em que a janela nativa aparece.
**Teste independente:** `tests/boot.spec.ts` — "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram".

**Aceite**

1. **Dado** que `jarvis.boot` não existe, **quando** o app abre, **então** `data-testid="boot"` mostra "BIOS Modular v<versão>, Núcleo Holográfico", depois "Teste de memória" contando até `<K>K OK` e "Detectando dispositivos...", com Vídeo primário, Tela, Áudio e Motor de voz respondendo um por vez.
2. **Dado** a primeira tela, **então** o rodapé diz "Pressione DEL para entrar no SETUP, qualquer tecla para pular" e mostra o BIOS ID `JV-HOLO-<dígitos>-<8 hex>-00`. A tela não tem logo, nome JARVIS, data/hora nem SVG.
3. **Dado** o fim da detecção, **quando** o bipe toca, **então** a segunda tela substitui a primeira com a caixa "Configuração do sistema", "Listagem de dispositivos PCI...", "Verificando dados do pool DMI ............" e "Iniciando o núcleo holográfico...".
4. **Dado** o POST completo, **então** aparece `boot-startup` com o emblema e "Bem-vindo". O conjunto some num fade em tamanho cheio (escala > 0,9), sem "desligar o tubo" e sem o antigo `boot-flash`.
5. **Dado** o fim do boot, **então** a dock ("Quick actions") e a barra superior entram, a saudação aparece no núcleo e, sem contar a barra, nenhum texto fica na tela.
6. **Dado** o modo navegador, **então** o campo Motor de voz diz "modo navegador · só visual".

### US2 — Pular a tela (P1)

Não quero esperar: uma tecla ou um clique me leva ao desktop, e Delete me leva às Configurações.

**Por que P1:** a abertura não pode atrapalhar quem quer trabalhar.
**Teste independente:** `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings".

**Aceite**

1. **Dado** o boot na tela, **quando** aperto uma tecla sem Ctrl/Meta/Alt, **então** a tela some em 0,6 s e a tecla para ali: `M` não liga o microfone e o status de voz continua `idle`.
2. **Dado** o boot na tela, **quando** aperto Delete, **então** a tela some e o diálogo "Configurações" abre.
3. **Dado** o boot na tela, **quando** clico em qualquer ponto, **então** ela também pula.
4. **Dado** um atalho com Ctrl, Meta ou Alt, **então** o boot não o intercepta.

### US3 — Desligar e rever (P2)

Posso desligar a tela ou o som e rever a sequência quando quiser.

**Por que P2:** é uma preferência, não o fluxo principal.
**Teste independente:** `tests/boot.spec.ts` — "the advanced menu turns the boot off and replays it".

**Aceite**

1. **Dado** o Menu avançado → aba Cores → seção "Inicialização", **quando** desligo "Tela de inicialização", **então** `jarvis.boot.enabled` vira `false`.
2. **Dado** o boot desligado, **quando** recarrego, **então** não há boot nem saudação: o núcleo já está ligado.
3. **Dado** o menu aberto, **quando** clico "Ver agora", **então** o menu fecha e o boot toca de novo, mesmo desligado.
4. **Dado** a busca (`/`), **então** "Ver a tela de inicialização" e "Desativar a tela de inicialização" (ou "Ativar …") fazem o mesmo.
5. **Dado** o switch "Sons da inicialização" desligado, **então** a sequência toca muda.

### US4 — Janela sem tela branca (P2)

A janela do Windows só aparece quando já há algo desenhado.

**Por que P2:** evita o flash branco da WebView ao abrir.
**Teste independente:** indireto, com o core em 2D e desligado: `tests/core.spec.ts` — "with the core in 2D (the default), the boot screen still plays and hands over" e "with the core off, …".

**Aceite**

1. **Dado** o app desktop, **quando** o núcleo (3D, 2D ou desligado) desenha o primeiro quadro, **então** a janela é mostrada e focada, e o POST começa.
2. **Dado** que esse sinal não chega, **então** a UI mostra a janela após 500 ms e o Rust após 2,5 s.

## Critérios de sucesso

- **SC-001**: Uma tecla qualquer tira a tela do caminho (o teste dá até 5 s), sem efeito colateral nos atalhos.
- **SC-002**: Numa instalação nova, a sequência inteira termina sozinha e entrega um desktop sem texto além da barra superior.
- **SC-003**: O boot roda com qualquer modo de núcleo (3D, 2D, desligado).

## Fora de escopo e limitações

- Não há sondagem real de hardware. Os números são os que o navegador expõe, e o PCI é encenado.
- A tela não depende do Rust: no navegador ela roda igual, só que muda (sem gesto do usuário) e com o motor de voz em "modo navegador".
- A saudação e a volta para casa ficam em [greeting-homecoming](../../features/greeting-homecoming/spec.md).

## Código

O POST é um roteiro calculado uma vez (`buildScript`): uma lista de linhas com o instante em que cada uma aparece. Um laço `requestAnimationFrame` só avança o relógio, e a tela é uma função do tempo decorrido. Os sons disparam quando o relógio passa pelos instantes deles. A janela nativa nasce oculta e é revelada no primeiro quadro do núcleo. O boot só começa a "digitar" depois desse quadro e da fonte carregada.

| | |
|---|---|
| **Camadas** | UI React (`BootSequence`) · lib (`boot.ts`, `bootSound.ts`) · `App.tsx` (orquestração) · Rust (`lib.rs`, rede de segurança da revelação) |
| **Dependências** | `motion/react` (CRT ligando, fades), Web Audio API, `@fontsource/vt323`, WebGL (só para ler o nome da GPU) |
| **Testes** | `tests/boot.spec.ts`; `tests/core.spec.ts` (bloco "from a fresh start") |
| **Plataforma** | Windows 11 · WebView2. Fora do Tauri, roda igual: `reveal()` não faz nada, o motor de voz aparece como "modo navegador · só visual" e o áudio pode ficar suspenso |

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/components/BootSequence.tsx` | Roteiro do POST (`buildScript`), relógio, render das linhas (`TerminalLine`), tela de partida (`Startup`, `Rings`), teclas e clique para pular |
| `src/lib/boot.ts` | `BootPrefs` + `useBootPrefs` (`jarvis.boot`), `describeBoot` (BootInfo a partir de settings/modelos/qualidade/janelas), `probeSystem` (SystemProbe) |
| `src/lib/bootSound.ts` | `createBootSound(enabled)`: `beep`, `chime`, `hit`, `glitch`, `close`. `SILENT` quando desligado ou sem Web Audio |
| `src/lib/asciiFont.ts` | Letras "ANSI Shadow" (`asciiWord`), hoje sem nenhum importador |
| `src/App.tsx` | `booting`, `firstFrame`, `onFirstFrame` → `reveal()`, `finishBoot`, `replayBoot`, `bootInfo`, e o que espera o boot (dock `entered`, `Taskbar`, `CoreButton`) |
| `src/hooks/useWindowControls.ts` | `reveal()` e o fallback de 500 ms (`REVEAL_FALLBACK_MS`) |
| `src-tauri/src/lib.rs` | `REVEAL_FALLBACK` (2,5 s): mostra e foca a janela se ela ainda estiver oculta |
| `src/styles/globals.css` | `@utility crt-screen`, `crt-text`, `crt-flicker`, `crt-glitch`, `crt-cursor`, `crt-scanlines`, `crt-mask`, `crt-noise`, `crt-roll`, `crt-glass`. `--font-bios` |
| `src/components/desktop/AdvancedMenu.tsx` | Seção "Inicialização" na aba Cores |
| `src/lib/commands.ts` | `boot-replay`, `boot-toggle` (grupo Sistema) |

### Constantes do roteiro

| Constante | Valor | Uso |
|---|---|---|
| `LINE_MS` | 70 ms | por linha de texto |
| `DETECT_MS` | 240 ms | do nome do dispositivo à resposta |
| `GLITCH_MS` | 140 ms | glitch na troca de tela |
| `STARTUP_MS` | 2100 ms | tela de partida |
| `CHIME_DELAY` | 250 ms | acorde e emblema |
| `REDUCED_HOLD` | 1100 ms | pausa com movimento reduzido |
| `START_FALLBACK_MS` | 1500 ms | começa sem primeiro quadro/fonte |
| `MAX_STEP_MS` | 100 ms | avanço máximo por quadro |

### Fluxo

```mermaid
sequenceDiagram
  participant R as Rust (setup)
  participant A as App
  participant C as Núcleo (2D/3D/off)
  participant B as BootSequence
  R->>R: janela visible:false; thread dorme 2,5 s
  A->>C: render (ignition "standby")
  C-->>A: onFirstFrame()
  A->>A: reveal() (show + focus) · firstFrame = true
  A->>B: started = true
  B->>B: fonte VT323 carregada → relógio rAF
  B->>B: 1ª tela → clearAt: beep + glitch → resumo + PCI
  B->>B: startupAt + 250 ms: chime + emblema "Bem-vindo"
  B-->>A: onDone(openSettings) após fade 0,6 s
  A->>C: ignitedAt = now · pulse · pulse(+1,3 s)
  A->>A: Greeting · dock e barra entram
  R->>R: 2,5 s: se ainda oculta, show()
```

### Constituição

- [x] P1 Offline-first — tudo local: sondagem por APIs do navegador, sons sintetizados, fonte empacotada.
- [x] P2 Rust é dono do nativo — mostrar a janela é do Tauri (`getCurrentWindow().show()`, `REVEAL_FALLBACK` em `lib.rs`).
- [x] P5 Persistência tolerante — `parseBoot` valida campo a campo e volta ao padrão.
- [x] P6 Funciona fora do Tauri — a mesma tela roda no Vite. `reveal()` só age com `isTauri()`.
- [x] P7 PT-BR para o usuário — todo o texto do POST e os rótulos estão em PT-BR.
- [x] P8 Linguagem visual — cores dos tokens `hud-*`, utilitários `crt-*` em `globals.css`, emblema em `currentColor`.
- [x] P9 Desktop leve — o laço para quando a tela sai. O `AudioContext` fecha depois do acorde.
- [x] P11 Coberto por teste — três testes em `boot.spec.ts`, mais os dois do bloco "from a fresh start" em `core.spec.ts`.

### Decisões relacionadas

- [ADR-0001 — Tauri 2 + Rust como shell desktop](../../arch/adr/0001-tauri-rust-desktop.md)
- [ADR-0011 — fakes de dev e E2E no modo web](../../arch/adr/0011-fakes-de-dev-e-e2e-modo-web.md)
- [ADR-0013 — núcleo 2D padrão](../../arch/adr/0013-nucleo-2d-padrao.md)
- [ADR-0014 — linguagem visual TUI](../../arch/adr/0014-linguagem-visual-tui.md)

## Tarefas

Legenda: `[x]` feito · `[ ]` pendente · `[P]` pode rodar em paralelo (arquivos diferentes) · `[USn]` história desta spec. As tarefas foram reconstruídas do código e dos commits `42e671a`, `c4ccc57` e do working tree de 27/10.

### Fase 1 — Base

- [x] T001 `BootPrefs`, `parseBoot` e `useBootPrefs` (`jarvis.boot`) — `src/lib/boot.ts`
- [x] T002 [P] `probeSystem` e `gpuName` (renderer WebGL sem o invólucro ANGLE, até 46 caracteres) — `src/lib/boot.ts`
- [x] T003 [P] `describeBoot`: voz, ativação, tema (com "Personalizada <matiz>°"), versão `__APP_VERSION__` — `src/lib/boot.ts`
- [x] T004 [P] Sons sintetizados `beep`, `chime`, `hit`, `glitch` e `close` com fechamento atrasado — `src/lib/bootSound.ts`
- [x] T005 [P] Utilitários `crt-*` e `--font-bios` — `src/styles/globals.css`

### Fase 2 — US1 Assistir ao POST (P1)

- [x] T006 [US1] `buildScript`: banner, memória, detecção, resumo, PCI, DMI e hand-over — `src/components/BootSequence.tsx`
- [x] T007 [US1] Relógio rAF com `MAX_STEP_MS` e disparo de `beep`/`chime` ao passar dos instantes — `src/components/BootSequence.tsx`
- [x] T008 [US1] `TerminalLine` (text, memory, field, summary, dots, gap) e cursor piscante — `src/components/BootSequence.tsx`
- [x] T009 [US1] Tela de partida `Startup` com o emblema `Rings` e "Bem-vindo". Saída por fade, sem colapsar o tubo — `src/components/BootSequence.tsx`
- [x] T010 [US1] Integração: `booting`, `bootInfo`, `finishBoot`, e dock/barra/botão do núcleo esperando o boot — `src/App.tsx`
- [x] T011 [US1] BIOS "mais realista" em duas telas (evolução) — `c4ccc57`
- [x] T012 [US1] Campo "Tema" no lugar de "Tema e fundo" após a remoção do fundo — working tree (27/10)

### Fase 3 — US2 Pular (P1)

- [x] T013 [US2] Listener de teclado em captura: modificadores passam, Delete abre Configurações — `src/components/BootSequence.tsx`
- [x] T014 [US2] Clique pula (`onPointerDown`) e o fade de 0,6 s chama `onDone` — `src/components/BootSequence.tsx`

### Fase 4 — US3 Desligar e rever (P2)

- [x] T015 [US3] Seção "Inicialização" (switches e "Ver agora") — `src/components/desktop/AdvancedMenu.tsx`
- [x] T016 [P] [US3] Comandos `boot-replay` e `boot-toggle` — `src/lib/commands.ts`
- [x] T017 [US3] `replayBoot` descarta a saudação pendente — `src/App.tsx`

### Fase 5 — US4 Janela sem tela branca (P2)

- [x] T018 [US4] `reveal()` no primeiro quadro e fallback de 500 ms — `src/hooks/useWindowControls.ts`
- [x] T019 [P] [US4] `REVEAL_FALLBACK` de 2,5 s numa thread do `setup` — `src-tauri/src/lib.rs`
- [x] T020 [US4] POST só depois do primeiro quadro e da fonte, ou após `START_FALLBACK_MS` — `src/components/BootSequence.tsx`

### Fase 6 — Testes

- [x] T021 Playwright `tests/boot.spec.ts` — "the BIOS runs its POST over two screens, comes to life with the emblem and a welcome, and reveals the hologram"
- [x] T022 Playwright `tests/boot.spec.ts` — "any key skips without leaking into shortcuts; DEL goes to the settings"
- [x] T023 Playwright `tests/boot.spec.ts` — "the advanced menu turns the boot off and replays it"
- [x] T024 Playwright `tests/core.spec.ts` — "with the core in 2D (the default), the boot screen still plays and hands over" e "with the core off, the boot screen still plays and hands over"

## Pendências

- [ ] `src/lib/asciiFont.ts` (`asciiWord`) não é importado por nenhum arquivo de `src/` nem de `tests/`.
- [ ] O comentário de `BootPrefs.sound` em `src/lib/boot.ts` cita "keyboard clicks", que `src/lib/bootSound.ts` não sintetiza.
- [ ] O switch "Sons da inicialização" ("Bipe de POST e o acorde ao ligar") também silencia os impactos da saudação e os zaps do `JarvisReply`, mas o texto não diz isso.
