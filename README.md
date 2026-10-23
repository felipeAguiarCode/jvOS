# JARVIS OS

Ambiente desktop com um núcleo holográfico 3D em tempo real, inspirado nas interfaces de IA dos filmes do Homem de Ferro, e um assistente de voz local. A tela tem quatro coisas:

1. **JARVIS CORE**: holograma wireframe em seis camadas (azul, verde Matrix, amarelo digital ou uma cor sua), sempre em movimento, que reage à voz. Para poupar memória, o Menu avançado → **Núcleo** troca por anéis 2D (sem WebGL) ou desliga o núcleo.
2. **QUICK ACTION DOCK**: dock minimalista na parte inferior (pode ser desligada no Menu avançado → Dock).
3. **WIDGETS E APPS**: janelas flutuantes no estilo de um desktop Linux — os widgets relógio, pomodoro, bateria, calculadora, **Fita** e **Mini player**, abertos pelo item **Widgets** da dock, e os apps **Jarvis Mark** (editor de Markdown), **Jarvis Code** (editor de código) e **jv_T4p3** (player de música TUI com as rádios do GTA Vice City e playlists de links do YouTube), abertos pelo item **Apps**, e o **jv_sh** (terminal de verdade, em abas, com os perfis do seu Windows Terminal), aberto pelo item **Terminal**. Arrastam, encaixam nas bordas, redimensionam e voltam onde estavam.
4. **BARRA SUPERIOR**: estilo Waybar, ligada por padrão e minimalista: busca, microfone, as janelas abertas, a janela em foco, pomodoro e música quando ativos, bateria e hora.

O assistente roda **100% local**, com o [Whisper](https://github.com/ggml-org/whisper.cpp). Você **segura o microfone para falar**, como no WhatsApp, ou deixa o assistente esperando **"Hey Jarvis"** ou **escutando o tempo todo**. Ele abre os programas associados às palavras-chave que você configura.

Stack: Tauri 2 · Rust · whisper.cpp (`whisper-rs`) · cpal · React 19 · TypeScript · Vite · Three.js · @react-three/fiber · @react-three/drei · @react-three/postprocessing · Motion · Tailwind CSS 4 · Lucide · CodeMirror 6 · react-markdown · Web Audio API.

---

## 1. Pré-requisitos (Windows)

| Ferramenta | Versão testada | Observação |
|---|---|---|
| Node.js | 22.x | com npm 10+ |
| Rust | 1.97 (`stable-x86_64-pc-windows-msvc`) | `rustup default stable-msvc` |
| Microsoft C++ Build Tools | VS 2022/2026, "Desktop development with C++" | inclui o componente **C++ CMake tools**, usado para compilar o whisper.cpp |
| LLVM (libclang) | 23.x | `winget install LLVM.LLVM` — gera os bindings do whisper.cpp para Windows |
| WebView2 Runtime | já vem no Windows 11 | |

`npm run dev` e `npm run tauri …` usam `scripts/tauri.mjs`, que encontra sozinho:
- o CMake do Visual Studio, quando ele não está no PATH;
- o libclang em `C:\Program Files\LLVM\bin`.

Fora do npm (por exemplo, `cargo test`), defina `CMAKE` e `LIBCLANG_PATH` manualmente.

Microfone: em **Configurações → Privacidade e segurança → Microfone**, ative "Acesso ao microfone" e "Permitir que aplicativos da área de trabalho acessem o microfone". Notebooks com **tecla de mudo do microfone** (geralmente F4, com LED) entregam silêncio sem o Windows indicar mudo. Nesse caso, o app avisa "O microfone não está captando som".

## 2. Instalação

```powershell
npm install
```

## 3. Desenvolvimento

```powershell
npm run dev       # app desktop (Vite + Rust + janela Tauri com hot reload), o mesmo que npm run tauri dev
npm run dev:web   # só o frontend em http://localhost:1420 (sem voz nem abertura de programas)
```

A primeira compilação leva alguns minutos, por causa do whisper.cpp. Mesmo no perfil de desenvolvimento, o whisper.cpp é compilado com otimização: sem ela, cada frase levaria dezenas de segundos.

## 4. Build desktop

```powershell
npm run tauri build                # executável + instaladores (MSI/NSIS) em src-tauri/target/release/bundle
npm run tauri build -- --no-bundle # só o executável: src-tauri/target/release/jarvis.exe
```

### Testes

```powershell
npm run build                                        # typecheck + build do frontend
npm test                                             # Playwright (Edge instalado)
cd src-tauri; cargo test                             # Rust: terminal (perfis do Windows Terminal, JSONC, linha de comando, sessão real num ConPTY, jvfetch instalado e rodando numa aba), matcher (janelas e música), VAD, resampler, launcher, settings, modelos, arquivos dos editores, yt-dlp (checksum, resposta, links)
cd src-tauri; cargo test --lib music -- --ignored     # rede: baixa o yt-dlp numa pasta temporária e resolve "Blondie - Atomic"
cd src-tauri; cargo test -- --ignored speech         # ponta a ponta com fala real (baixa o Large V3 Turbo, ~1,6 GB, na 1ª vez)
```

**Playwright** (gera screenshots em `test-results/screens/`):
- composição em 1366×768, 1080p, 1440p e ultrawide;
- dock;
- microfone falso e acesso negado (nível, fala e espectro reagem);
- texto ouvido: centralizado no núcleo, palavras com opacidade alta, some depois;
- painel de configurações: modo, idioma, cor, palavras-chave e programas personalizados, todos persistentes;
- cor do JARVIS: o holograma (medido na screenshot) e a interface trocam de cor na hora;
- fundo: Preto, Grid côncavo e Matrix aparecem ao lado do holograma (o grid fica abaixo do limiar de brilho do holograma) e a escolha persiste;
- inicialização: a BIOS (sem logo, nome nem data e hora) digita o POST e a máquina "liga" (emblema e "Bem-vindo", sem "JARVIS / ONLINE" e sem a tela encolher ao sair) antes de revelar o holograma; qualquer tecla pula sem acionar atalhos (o `M` não liga o microfone); `DEL` abre as Configurações; desligar e "Ver agora" no Menu avançado. Os demais testes começam com a inicialização e a barra superior desligadas (`storageState` em `playwright.config.ts`); a saudação é uma das frases de `src/lib/greetings.ts` e muda na inicialização seguinte;
- widgets e apps: um launcher acima do item Widgets (só widgets) e outro acima do item Apps (só apps), um de cada vez; janelas arrastam com encaixe nas bordas (guias visíveis), nunca saem da tela, redimensionam até o mínimo, voltam no mesmo lugar após recarregar, clicar traz para frente, clicar na área vazia deixa nenhuma em foco (sem mexer em nada) e a dock fica por cima; avisos de apps aparecem acima de Apps; relógio, calculadora (botões e teclado), pomodoro (contagem, pausa que sobrevive ao reload, fim de fase com aviso na dock e pulso do holograma), bateria; editor de Markdown (visualização ao vivo, `Ctrl + B`, rascunho) e editor de código (linguagem escolhida, destaque de sintaxe, rascunho); menu avançado (encaixe desligado, lado a lado, centralizar, matiz personalizado salvo nas configurações).
- barra superior: ligada numa instalação nova, só depois da inicialização; liga/desliga nas Configurações, no Menu avançado e na busca; módulos ao vivo; título "JARVIS OS" sem janela em foco; app maximizado para abaixo dela;
- aba Voz: todas as seções e frases padrão; acrescentar, tirar e restaurar frases (salvas em `voiceCommands`); palavras-chave dos programas; interação nova (tocar uma playlist, depois Pomodoro) sobrevive ao reload e é removida; a busca acha "comandos de voz"; Pomodoro por voz (iniciar, pausar, +5/−5 min, pular, reiniciar, com e sem o widget);
- jv_sh (um shell de eco falso substitui o ConPTY no navegador): o item Terminal abre o perfil padrão com o foco no terminal; o que se digita chega ao shell; "+" e o menu de perfis abrem abas, `Ctrl+Tab` troca, `Ctrl+Shift+T`/`Ctrl+Shift+W` abrem e fecham; maximizar pelo botão ou duplo clique avisa o shell do novo tamanho; `Ctrl+W`, `/` e `m` ficam no shell; o × fecha a janela e todos os shells; `exit` fecha a aba, `exit 3` a mantém com o código, a última aba fecha a janela; voz e busca ("Nova aba: Git Bash");
- jv_T4p3 (o yt-dlp é substituído por um WAV silencioso gerado na página): as 7 rádios e suas faixas; sem yt-dlp diz "Disponível no app desktop"; `←→`/`↑↓`/Enter tocam, a fita gira tocando e para pausada, tempo e barra andam, `n`/`b`/volume/aleatório, a faixa que acaba puxa a próxima; playlists próprias (criar, colar links de vários formatos, recusar link inválido ou repetido, remover, renomear, sobreviver ao reload, tocar, apagar com confirmação); widgets Fita e Mini player acompanham a música, que continua com o player fechado e pausa pela barra superior; voz (abrir/fechar player e widgets, "toca a <playlist>" inclusive as suas, próxima, anterior, pausa, continua, muda a playlist, nome desconhecido); busca "Tocar <rádio>", pausar e próxima;
- núcleo: Menu avançado → Núcleo troca o holograma 3D pelos anéis 2D na hora (o canvas WebGL some, os anéis seguem a voz e se deitam no equador ao ouvir) e lembra a escolha; aberto no 2D, o three.js nem é baixado; desligado, a área de trabalho continua clicável e a busca ("núcleo 3d") religa o holograma; a BIOS roda e passa a vez no 2D e desligado;
- dock: Menu avançado → Dock a desliga (fora de alcance do teclado e do leitor de tela; os avisos continuam na base da tela; a escolha sobrevive ao reload) e a busca a traz de volta; a ampliação dos ícones pode ser desligada;
- alinhamento: partículas e anéis se alinham no equador enquanto Voice está segurado e se dispersam ao soltar;
- segurar para falar: o microfone só abre enquanto Voice ou `M` está segurado, com cronômetro; um clique rápido nunca o deixa ligado; deslizar para a esquerda ou `Esc` cancela.

**Teste de fala real** (`src-tauri/tests/fixtures/*.wav`, frases geradas com a voz pt-BR do Windows):
- "Hey Jarvis, abre o navegador"
- "Ei, Jarvis" seguido de "Abre o VS Code"
- "Jarvis, abre o Claude Code"
- "Que horas são agora?" (deve ser ignorada)
- "Abre a bateria." e "Jarvis, fecha a calculadora." (janelas do JARVIS; sem "Jarvis", a primeira é ignorada no modo Hey Jarvis). A voz sintetizada pronuncia "relógio" e "pomodoro" de um jeito que o Whisper não reconhece, por isso não entram aqui.

Elas passam pelo VAD, pelo Whisper e pela decisão, nos dois modos.

## 5. Assistente de voz

### Fluxo

```
microfone (cpal, Rust) → mono 16 kHz → VAD por energia → Whisper (frase) → “Jarvis”? palavra-chave? → abre o programa
                                                                                                  → abre/fecha a janela do JARVIS
```

- O motor roda numa thread própria do Rust, independente do WebView. Por isso os comandos funcionam **com a janela minimizada**.
- O **VAD** recorta cada frase (≈660 ms de silêncio encerram) e descarta ruídos curtos. O Whisper só roda quando alguém fala.
- O **Whisper** usa o modelo **Large V3 Turbo** (`ggml-large-v3-turbo`, f16, 1,6 GB), o padrão, ou o `ggml-base-q5_1` (60 MB) como reserva leve. Ele recebe:
  - o idioma (pt/en/auto);
  - um *prompt* com "Hey Jarvis" e as palavras-chave, que ajuda na grafia;
  - uma janela do encoder dimensionada à frase.

  Resultado: **~0,9 s por comando** num notebook com CPU de 8 threads, contra ~2,7 s com a janela padrão de 30 s.
- **"Jarvis"** é reconhecido com tolerância: "Ei Jarvis", "Rei Jarbas", "redjarvis", "Jarvys".
- **Palavras-chave** também são comparadas com tolerância: sem acento, com 1 erro de grafia em palavras longas, e "vs code"/"vscode" contam como iguais. Se houver mais de uma correspondência, vence a mais longa.
- Antes de agir, o motor descarta trechos que o Whisper considera "não fala" e saídas que só repetem o prompt (alucinação em ruído).

### Modos

| Modo | Como usar | Holograma |
|---|---|---|
| **Segurar para falar** (padrão) | Segure o botão **Voice** (ou a tecla `M`) e diga o comando ("abre o terminal"), sem "Hey Jarvis". Ao soltar, o microfone fecha e a frase vai para o Whisper | Só reage enquanto o botão está segurado |
| **Hey Jarvis** | Uma frase só ("Hey Jarvis, abre o terminal") ou em duas etapas ("Ei, Jarvis" e, em até 8 s, "terminal") | Em espera reage à voz de forma mais suave. Ao ouvir "Jarvis", pulsa e passa a reagir por completo |
| **Sempre ouvindo** | Qualquer frase com uma palavra-chave ("abre o navegador") | Reage o tempo todo |

No modo **Segurar para falar**, o botão funciona como o do WhatsApp:
- Enquanto você segura, aparece à esquerda da dock uma faixa com a luz vermelha de gravação, o cronômetro e "‹ Deslize para cancelar". O cronômetro começa quando o microfone abre de fato. Antes disso, se o modelo ainda está carregando, a faixa mostra "…".
- **Soltar envia**. **Deslizar 120 px para a esquerda** (o texto acompanha o ponteiro e esmaece) ou apertar **`Esc`** cancela: a gravação é descartada sem chegar ao Whisper e a dock avisa "Gravação cancelada".
- Um **toque rápido** (menos de 0,35 s) não grava nada e mostra "Segure para falar".
- O microfone só fica aberto enquanto o botão está segurado. Com ele solto, nem o Rust nem o WebView capturam áudio.
- O modelo continua carregado, então não há espera ao apertar. Se a escuta estiver desligada, o primeiro aperto a liga e carrega o modelo.
- Uma gravação sem fala (clique, silêncio) é descartada sem chamar o Whisper. Se o microfone só entregou silêncio digital, o app avisa que ele parece estar mudo.
- O botão aceita mouse, toque e teclado (Espaço/Enter com ele em foco). Arrastar o ponteiro para cima ou para a direita, mesmo para fora do botão, não interrompe. A janela perder o foco solta o botão (e envia).

O mesmo programa não é reaberto por repetição em menos de 4 s.

### Widgets e apps por voz

Tudo o que a voz entende fica em **Menu avançado → Voz**: as palavras de cada janela, os verbos de abrir, fechar e tocar, os grupos, a música, o Pomodoro e as palavras-chave dos programas. Ali dá para acrescentar e tirar frases ("restaurar" volta ao padrão) e criar **interações suas** para qualquer ação ("hora de treinar" → tocar a sua playlist, "bora focar" → iniciar o Pomodoro). Fica salvo nas configurações (`voiceCommands`); os padrões vêm de `src-tauri/voice-commands.json`, lido pelo Rust e pela interface. As tabelas abaixo são os padrões.

Os widgets e apps do JARVIS abrem e fecham pela voz, em qualquer modo (com "Hey Jarvis" no modo Hey Jarvis):

| Janela | Palavras-chave |
|---|---|
| Relógio | relógio, clock |
| Pomodoro | pomodoro, temporizador, timer |
| Bateria | bateria, battery |
| Calculadora | calculadora, calculator |
| Jarvis Mark (Markdown) | jarvis mark, markdown, editor de markdown |
| Jarvis Code (código) | jarvis code, código |
| jv_T4p3 (player de música) | tape, jv tape, player, player de música, tocador |
| jv_sh (terminal) | terminal, jv sh, shell, console, prompt de comando (o Windows Terminal externo atende por "windows terminal") |
| Fita (widget) | fita, cassete, fita cassete |
| Mini player (widget) | mini player, miniplayer, controle de música |

- **Abrir:** a palavra-chave sozinha ou com "abre", "abrir", "mostra" ("abre o relógio", "mostra a bateria"). Se a janela já está aberta, ela vem para a frente.
- **Fechar:** com "fecha", "fechar", "encerra", "esconde" ("fecha a calculadora", "o relógio, pode fechar"). O verbo mais próximo antes da palavra-chave decide.
- **Fechar em grupo:** "fecha todos os widgets", "fecha todas as aplicações" (ou "os apps", "os aplicativos": Jarvis Mark e Jarvis Code), "fecha todas as janelas" ou "fecha tudo". Só com verbo de fechar; se a frase nomear uma janela, ela vence ("fecha a calculadora e os widgets" fecha só a calculadora). A dock diz quantas fechou. Também na busca (`/`).
- A dock avisa ("Abrindo Relógio", "Fechando Calculadora") e o holograma pulsa.
- **Música** (jv_T4p3, com a janela aberta ou não; a dock responde acima do item Apps): "toca a Flash FM" / "coloca a playlist treino" (rádios do jogo e suas playlists, pelo nome: "toca a wave", "toca a wild style"), "dá play" / "play" / "continua a música" / "volta a tocar", "pausa" / "pausar" / "para a música", "próxima música" / "pula essa música", "volta a música" / "música anterior" / "volta para a música anterior", "muda a playlist" / "troca de rádio" (a próxima com músicas), "rádio anterior", "muda a playlist para a V-Rock". As frases de controle valem palavra por palavra ("toca a playlist X" não vira "troca a playlist"); "abre a fita" continua sendo abrir o widget.
- **Pomodoro** (com o widget aberto ou não; a dock responde acima de Widgets): "inicia o pomodoro" / "começa o foco" / "inicia o timer", "pausa o pomodoro" / "para o pomodoro", "continua o pomodoro", "reinicia o pomodoro" (a fase atual), "pula a fase" / "próxima fase", "mais cinco minutos" / "aumenta o pomodoro", "menos cinco minutos" / "diminui o pomodoro". "pomodoro" sozinho (ou "abre o pomodoro") abre o widget; "fecha o pomodoro" fecha.
- Frases de ação valem palavra por palavra e a mais longa vence ("pausa o pomodoro" não pausa a música; "volta a tocar" não é "volta a música"). Abrir ou fechar com o verbo ("abre a fita", "fecha o pomodoro") vem antes das ações.
- **"editor de código"** continua abrindo o VS Code (é palavra-chave dele desde o início e a mais longa vence). Para que abra o editor do JARVIS, remova essa palavra-chave do VS Code em Configurações.
- **Fechar programas externos** (navegador, terminal…) não é possível: "fecha o terminal" não abre nada e a dock avisa.

### Ao iniciar

A escuta **volta ligada** se estava ligada quando o app foi fechado. Se estava desligada, começa desligada.

**Tela de inicialização:** uma BIOS antiga num monitor CRT, no jeito do terminal do SUPERHOT, na cor do JARVIS.
- Ao terminar, o **planeta liga**: o holograma nasce de um ponto girando até o tamanho final, com pulsos de energia, e uma saudação aparece dentro dele — **varia a cada inicialização**, entre mais de 50 frases ("Olá Builder, o que vamos fazer hoje?", "Sistemas online. Às suas ordens, Builder.", "Bom dia, Builder. Café e código?", "Sexta-feira, Builder. Último sprint da semana?"…). Algumas só aparecem em certas horas ou dias da semana e, quando cabem, têm mais chance; nenhuma das últimas cinco se repete (`jarvis.greeting.recent`). A lista fica em `src/lib/greetings.ts` — no estilo dos textos do SUPERHOT (maiúsculas pesadas, palavra por palavra, levemente transparentes), cada palavra com um impacto sonoro sintetizado; depois some com um glitch.
- O tubo acende de um ponto para uma linha e depois para a tela inteira. É uma BIOS neutra, sem logo, sem o nome JARVIS e sem data e hora no canto: a versão, o teste de memória contando e um bipe de POST.
- Os comandos são digitados no prompt `C:\>`, com clique de teclado. As checagens usam dados reais: núcleos da CPU, GPU, tela, perfil gráfico, motor de voz (avisa se o modelo não foi baixado), modo de ativação, tema, fundo e janelas restauradas.
- No fim do POST a máquina **liga**: o texto e a textura do CRT somem, um acorde quente soa e o emblema do JARVIS aparece no centro com "Bem-vindo". A tela então se desfaz em fade (sem efeito de tubo desligando) e o holograma pulsa ao aparecer. A dock entra em seguida.
- O efeito CRT tem scanlines, brilho de fósforo, aberração cromática, máscara RGB, ruído, faixa de varredura rolando, cintilação e cantos de vidro curvo.
- **Qualquer tecla ou clique pula** (as teclas não chegam aos atalhos) e **`DEL` pula direto para as Configurações**. Com "reduzir movimento" no Windows, tudo aparece de uma vez, sem animação.
- Começa no primeiro quadro do holograma (quando a janela aparece) e dura ~6 s.
- Menu avançado → Cores → **Inicialização**: ligar/desligar, sons (bipe, teclado e o acorde) e "Ver agora". Fica salvo em `jarvis.boot`.

### Programas

- Browser, VS Code, Terminal e Claude Code vêm configurados. Clicar no ícone da dock também abre o programa.
- Em **Configurações** é possível editar palavras-chave e comandos, adicionar programas e testar cada um.
- O comando é executado com `cmd /C start "" <comando>`, que aceita:
  - nome no PATH (`wt`, `notepad`);
  - caminho entre aspas (`"C:\…\app.exe" --flag`);
  - URL (`https://…`).
- Os padrões:

| Programa | Comando |
|---|---|
| Browser | `https://www.google.com` (navegador padrão) |
| VS Code | `Code.exe` (detectado) |
| Terminal | `wt` |
| Claude Code | `wt claude` |

### Onde ficam os dados

| O quê | Onde |
|---|---|
| Configurações | `%APPDATA%\dev.jarvis.os\settings.json` |
| Modelos Whisper | `%LOCALAPPDATA%\dev.jarvis.os\models\` (baixados pelo painel, com SHA-256 verificado) |
| Janelas abertas e posições, pomodoro, rascunhos dos editores, tela de inicialização | `localStorage` do WebView2 (`%LOCALAPPDATA%\dev.jarvis.os\EBWebView`): chaves `jarvis.desktop`, `jarvis.pomodoro`, `jarvis.editor.markdown`, `jarvis.editor.code`, `jarvis.boot`, `jarvis.tui`, `jarvis.taskbar`, `jarvis.dock`, `jarvis.greeting.recent`, `jarvis.music` (playlist em exibição, volume, aleatório), `jarvis.music.playlists` (suas playlists de links do YouTube), `jarvis.migrations.taskbarOn` (liga uma vez a barra superior de instalações antigas, onde ela estava salva como desligada) |
| yt-dlp do jv_T4p3 | `%LOCALAPPDATA%\dev.jarvis.os\bin\yt-dlp.exe` (baixado do GitHub oficial no primeiro play, com SHA-256 conferido; "atualizar yt-dlp" no rodapé do player). Se já houver um `yt-dlp.exe` no PATH, ele é usado. Nada de áudio é salvo em disco: o player toca o stream |
| Arquivos dos editores | Onde você salvar (diálogo nativo do Windows; texto UTF-8 até 2 MB) |

## 6. Organização

```
src/
├── App.tsx                       cena + dock + painel; liga a escuta, os avisos e a captura visual
├── components/
│   ├── JarvisScene.tsx           Canvas, câmera, composição responsiva, parallax, fog, bloom (carregado só com o núcleo 3D)
│   ├── FlatCore.tsx              núcleo 2D: os anéis em camadas SVG giradas pelo compositor, sem WebGL; e o núcleo desligado
│   ├── SceneBackground.tsx       fundo em tela cheia atrás do holograma (grid côncavo, Matrix)
│   ├── JarvisCore.tsx            camadas 01 (núcleo), 02 (esfera externa), 06 (halo)
│   ├── OrbitalRings.tsx          camada 03: anéis e runners
│   ├── HudFragments.tsx          camada 04: escalas, colchetes, marcadores, ping de scan
│   ├── HolographicParticles.tsx  camada 05: partículas em órbita (vertex shader)
│   ├── VoiceWave.tsx             camada 07: anéis de onda e barras de espectro (só aparecem com fala)
│   ├── VoiceCaption.tsx          texto ouvido, palavra por palavra, dentro do núcleo
│   ├── AudioDriver.tsx           por frame: relógio + análise de áudio → uniforms
│   ├── QuickDock.tsx             dock (controlada): magnificação, tooltip, avisos, indicadores, launchers; desligada, só os avisos
│   ├── SettingsPanel.tsx         painel de configurações
│   ├── hud.tsx                   primitivas da interface (seções, cards, switch, slider, chips) usadas pelos painéis
│   ├── BootSequence.tsx          tela de inicialização: POST de BIOS num CRT (linha do tempo derivada do tempo decorrido)
│   ├── Greeting.tsx              saudação estilo SUPERHOT dentro do núcleo, depois da inicialização
│   ├── Spotlight.tsx             barra de busca (`/`): procura e executa widgets, apps, programas e menus
│   ├── Taskbar.tsx               barra superior estilo Waybar (ligada por padrão)
│   └── desktop/
│       ├── Desktop.tsx           camada das janelas: encaixe, guias, pomodoro sempre vivo
│       ├── Window.tsx            moldura: barra de título que arrasta, 8 alças de redimensionar, Ctrl+W
│       ├── Launcher.tsx          menus acima dos itens Widgets e Apps
│       ├── AdvancedMenu.tsx      menu avançado centralizado: cores (matiz), janelas (encaixe), layout, TUI, barra superior, dock, voz
│       ├── VoiceTab.tsx          aba Voz: todas as frases por ação, restaurar padrão, interações do usuário
│       ├── musicParts.tsx        peças do jv_T4p3 usadas também pelos widgets (tempo, rótulo, barra magenta, teclas)
│       ├── widgets/              Clock, Pomodoro, Battery, Calculator, TapeWidget (Fita), MiniPlayer
│       └── apps/                 CodeMirror (wrapper), MarkdownEditor, CodeEditor, barra de status e toolbar, TapePlayer (jv_T4p3), ShellApp (jv_sh: abas e xterm.js)
├── hooks/
│   ├── useAudioAnalyzer.ts       Web Audio para a reatividade visual (+ atenção e pulso)
│   ├── useVoiceAssistant.ts      motor de voz do Rust: estado, eventos, iniciar/parar
│   ├── useSettings.ts            configurações (salvamento com debounce) e modelos (download)
│   ├── useDesktop.ts             janelas abertas, geometria, ordem e preferências (jarvis.desktop)
│   ├── usePointerDrag.ts         arraste com pointer capture (barra de título e alças)
│   ├── usePomodoro.ts            cronômetro pelo relógio de parede (jarvis.pomodoro)
│   ├── useEditorDocument.ts      rascunho, estado "sujo" e abrir/salvar dos editores
│   ├── useDockNotice.ts          aviso temporário acima de um item da dock
│   ├── useMusicPlayer.ts         jv_T4p3: um <audio> para o app todo, yt-dlp, playlists (jarvis.music.playlists), relógio fora do estado
│   ├── useTapeTick.ts            passo da animação da fita (só tocando, parada com movimento reduzido)
│   ├── useWindowControls.ts      atalhos, revelar janela, pausa ao minimizar
│   └── useDisposables.ts         descarte de geometrias/materiais
├── shaders/hologram/             materiais de linhas, pontos, halo e onda de voz; uniforms compartilhados
├── shaders/background/           quad de tela cheia: cúpula em ray casting, chuva Matrix com atlas de glifos
├── lib/                          geometria, layout, anéis, qualidade, sinais, tema (presets + matiz OKLCH), settings,
│                                 desktop (geometria das janelas), snap, storage, calc (calculadora), files, editorTheme, beep,
│                                 boot (preferências e sondagem do sistema), bootSound, asciiFont (letras de bloco, hoje sem uso), dictation,
│                                 search (busca sem acento e ranking), commands (tudo o que a busca encontra), greetings (saudações),
│                                 tui, taskbar (módulos da barra), dock (preferências da dock), core (núcleo 3D, 2D ou desligado),
│                                 sceneColors (cores do tema para os shaders, só no 3D),
│                                 music/ (stations: as rádios do Vice City; cassette: a fita em texto; youtube: links;
│                                 match: nome falado → playlist)
src-tauri/src/
├── lib.rs                        comandos Tauri, estado do app, restauração da escuta, plugin de diálogo
├── settings.rs                   modelo de configurações (inclui os comandos de voz), saneamento, JSON atômico
├── files.rs                      leitura/escrita de texto para os editores (caminho absoluto, UTF-8, 2 MB)
├── download.rs                   download verificado (SHA-256, .part) dos modelos e do yt-dlp
├── launcher.rs                   abre os programas (cmd /C start)
├── terminal.rs                   jv_sh: perfis do Windows Terminal (JSONC), shells em ConPTY (portable-pty), saída em UTF-8, encerramento,
│                                 jvfetch no PATH das abas (jvfetch.cmd e jvfetch para bash, em %LOCALAPPDATA%dev.jarvis.osjv_sh)
├── music.rs                      yt-dlp do jv_T4p3: localizar, instalar/atualizar, resolver o stream de áudio (busca ou id do vídeo)
├── models.rs                     catálogo e download verificado dos modelos Whisper
└── voice/
    ├── mod.rs                    motor: thread de captura → VAD → Whisper → decisão → eventos
    ├── audio.rs                  microfone (cpal) e conversão para 16 kHz mono
    ├── vad.rs                    detecção de fala por energia com piso de ruído adaptativo
    ├── transcriber.rs            Whisper (whisper-rs)
    └── matcher.rs                normalização, "Jarvis", palavras-chave, janela de 8 s, cooldown
src-tauri/jvfetch.ps1             o jvfetch (dados reais via registro e CIM; cores pela paleta do jv_sh)
scripts/tauri.mjs                 wrapper do CLI do Tauri (CMake + libclang)
tests/                            Playwright
src-tauri/tests/fixtures/         falas sintetizadas para o teste de ponta a ponta
```

### O holograma

| Camada | Conteúdo |
|---|---|
| 01 Núcleo | Esfera lat/long com o eixo inclinado, treliça geodésica contra-rotativa, nós luminosos, banda de escaneamento |
| 02 Esfera externa | Arcos interrompidos com escalas de ticks e um grande círculo fragmentado |
| 03 Anéis | Quatro órbitas com segmentos iluminados, círculo gêmeo, ticks e runners com rastro |
| 04 HUD | Escala de 270°, círculo pontilhado, colchetes, marcadores e ping de scan |
| 05 Partículas | Bandas que seguem os anéis e uma casca ao redor do núcleo. Navegam livres: órbitas que aceleram e desaceleram, planos de órbita que balançam, raio que respira, sobe e desce e pequenos laços ao longo do caminho |
| 06 Halo | Limbo fino, véu discreto e kernel pequeno |
| 07 Onda de voz | Três anéis de onda e 120 barras radiais voltados para a câmera, deformados pelo espectro da fala. Invisíveis em silêncio |

- **Alinhamento ao ouvir:** enquanto o JARVIS ouve um comando (botão segurado, depois do "Hey Jarvis", ou durante a fala no modo Sempre ouvindo), os quatro anéis giram um após o outro até o equador do núcleo, como um giroscópio travando, e as partículas pousam nesse plano, formando um disco nas faixas dos anéis, como os anéis de Saturno. Todas giram no mesmo sentido, as internas mais rápido. A onda de alinhamento vai de dentro para fora, e cada partícula parte de onde está. Ao parar de ouvir, tudo se dispersa de volta.
- **Profundidade:** o lado de trás de cada camada escurece, e um fog preto com blending aditivo reforça o efeito.
- **Bloom:** seletivo por luminância. As linhas permanecem nítidas.
- **Desempenho:** geometria criada uma vez; o `useFrame` só altera rotações e uniforms. A resolução nunca passa da densidade real da tela (o monitor de desempenho baixa e volta, mas não faz supersampling: numa tela 1× isso custava ~300 MB de memória de vídeo e ~10 fps). Atrás de um app maximizado o holograma desenha o primeiro quadro e para, voltando ao restaurar. Para gastar menos ainda, há o núcleo 2D e o desligado (Menu avançado → Núcleo). Relógios que mudam várias vezes por segundo (música, Pomodoro) atualizam só quem os mostra, não o app inteiro.

## 7. Reatividade visual ao áudio

A captura visual (Web Audio, no WebView) acompanha a escuta. No navegador, sem o app desktop, o botão Voice liga apenas essa captura.

| Sinal | Efeito |
|---|---|
| Nível (RMS) | Expansão de até +5%, halo, bloom, ping mais frequente |
| Bass | Pulso de até +7% da esfera interna, ondulação, treliça e kernel |
| Mid | Velocidade (até ~2,2×) e brilho dos anéis |
| Treble | Brilho e tamanho das partículas |
| Fala (voz acima do ruído) | O holograma inteiro clareia (linhas, partículas, anéis, bloom), o halo vira uma aura, a onda de voz aparece e o ping acelera |
| Espectro (32 bandas, 90 Hz–7 kHz) | Forma da onda de voz e altura das barras: graves no topo, agudos embaixo, espelhados |
| "Jarvis" ouvido / comando executado | Pulso: expansão, flash e ping a partir do núcleo |
| Ouvindo um comando | Anéis e partículas se alinham no equador do núcleo (≈0,35 s para alinhar, ≈0,7 s para dispersar) |
| Silêncio | Tudo decai e volta ao repouso |

Detalhes da análise:
- O nível vai de −60 a −18 dBFS e é normalizado por um pico móvel.
- As bandas representam o equilíbrio espectral multiplicado pelo nível.
- O envelope tem ataque de 50 ms e release de 380 ms.
- A fala é detectada em relação a um piso de ruído adaptativo: começa 6 dB acima dele e satura a 18 dB, com ataque de 60 ms e release de 450 ms, para não piscar entre sílabas. Funciona com microfones baixos e altos.
- No modo Hey Jarvis em espera, a reação é atenuada para ~70%.

### Texto dentro do holograma

No app desktop, cada frase transcrita aparece no centro do núcleo:
- Enquanto o Whisper processa a frase, três pontos pulsam no núcleo.
- As palavras surgem uma a uma, de desfocadas a nítidas, com opacidade de 92%, sobre um fundo escuro translúcido que deixa o holograma visível.
- O texto some após ~3 s mais 0,2 s por palavra. Frases longas mostram só as últimas 18 palavras.

## 8. Controles

| Ação | Controle |
|---|---|
| Ligar/desligar a escuta | Clique em **Voice** · tecla `M` (fora de campos de texto) · interruptor no painel |
| Falar no modo Segurar para falar | Segurar **Voice** ou `M` enquanto fala; soltar envia; deslizar para a esquerda ou `Esc` cancela (o interruptor do painel descarrega o modelo) |
| Cor do JARVIS | Configurações → **Aparência**: Azul, Verde Matrix ou Amarelo digital (vale para o holograma e a interface, na hora) |
| Fundo | Configurações → **Aparência**: Preto, Grid côncavo (interior de uma cúpula) ou Matrix (chuva de caracteres), na cor do JARVIS |
| Configurações | Ícone de engrenagem · `Ctrl + ,` · fechar com `Esc` |
| Menu avançado | Botão no rodapé das Configurações · `Ctrl + Shift + ,` · botão nos launchers · busca (`/`) · fechar com `Esc`. Abas: **Cores** (cor do JARVIS, matiz, fundo, inicialização), **Núcleo** (holograma 3D, anéis 2D ou desligado; salvo em `jarvis.core`), **Janelas** (encaixe, opacidade), **Layout** (organizar, grade), **TUI** (aberração cromática, brilho e cor de acento do Jarvis Mark e do Jarvis Code, com prévia; salvo em `jarvis.tui`), **Barra superior** (ligar/desligar e escolher os módulos: atalhos das janelas, status da voz, título, pomodoro, bateria, qualidade, data, hora; salvo em `jarvis.taskbar`), **Dock** (mostrar/ocultar e ampliar ícones; salvo em `jarvis.dock`), **Voz** (todas as frases que a voz entende, editáveis, e interações novas; ver *Widgets e apps por voz*) |
| Tela de inicialização | Qualquer tecla ou clique pula · `DEL` vai para as Configurações · Menu avançado → Cores → Inicialização (ligar, sons, "Ver agora") |
| Busca | `/` (fora de campos de texto) abre a barra de busca, como o Spotlight: widgets e apps (abrir/fechar), programas, Configurações e cada seção, Menu avançado e cada aba, organizar janelas, cor, fundo, modo de voz, escuta, qualidade, inicialização, tela cheia/minimizar/fechar. Sem acento e por pedaço de palavra · `↑ ↓` escolhe · `Enter` executa · `Esc` fecha |
| Widgets e apps | Item **Widgets** da dock abre o launcher dos widgets; item **Apps**, o do Jarvis Mark e do Jarvis Code (`Esc`, clique fora ou o próprio item fecha); cada item abre uma janela, uma por tipo · voz: "abre o relógio", "fecha a calculadora" · busca: "menu de widgets", "menu de apps" |
| Janelas | Arrastar pela barra de título (encaixa nas bordas e no centro, com guias) · redimensionar pelas bordas e cantos · `×` ou `Ctrl + W` fecha · clicar traz para frente · clicar na área vazia da tela (o holograma) deixa nenhuma em foco · Menu avançado → Layout organiza (lado a lado, cascata, centralizar) |
| Maximizar (Jarvis Mark e Jarvis Code) | Botão ao lado do `×` ou duplo clique na barra de título: **tela cheia**, por cima da dock e da parte inferior (abaixo da barra superior, se ela estiver ligada); de novo restaura. Arrastar a janela maximizada pela barra a devolve ao tamanho dela, sob o ponteiro. Fica salvo ao fechar e reabrir. Os widgets não maximizam |
| Barra superior | Ligada por padrão; entra depois da inicialização · **Menu avançado → Barra superior** (liga/desliga e escolhe cada módulo) · Configurações → Aparência → **Barra superior** · busca (`/`): "barra". Estilo Waybar, minimalista: busca, microfone (só o ícone; o estado no tooltip), um ícone por janela aberta (a em foco acesa), o título da janela em foco, pomodoro e música quando ativos (o artista no tooltip), bateria, hora e configurações. Qualidade gráfica e data ficam desligadas por padrão e ligam no Menu avançado. Os espaços vazios arrastam a janela |
| jv_sh (terminal) | Item **Terminal** da dock · Apps → jv_sh · voz "abre o terminal" · busca "Nova aba: <perfil>". Roda seus perfis do Windows Terminal (o padrão primeiro; WSL e Git Bash incluídos; Azure Cloud Shell e prompts do VS não) num pseudoconsole de verdade. `Ctrl+Shift+T` nova aba · ▾ escolhe o perfil · `Ctrl+Tab`/`Ctrl+Shift+Tab` trocam · `Ctrl+Shift+W` fecha a aba · `Ctrl+Shift+C` copia · `Ctrl+V`/`Ctrl+Shift+V` colam · botão direito copia a seleção ou cola. `Ctrl+C`, `Ctrl+W`, `Ctrl+Q`, `/` e `m` vão para o shell (F11 continua sendo tela cheia). Maximiza como os outros apps. Fechar a janela ou o JARVIS encerra os shells. **`jvfetch`** (em qualquer perfil: PowerShell, cmd, Git Bash, WSL) mostra a máquina no estilo do JARVIS, como o neofetch/winfetch: emblema de anéis, sistema, build, máquina, tempo ligado, shell, tamanho do terminal, tela, CPU, GPUs, memória, disco, bateria, tema e voz do JARVIS, e um diagnóstico ("disco quase cheio", "memória perto do limite", "bateria baixa" ou "todos os sistemas operacionais"). As cores seguem o tema; numa aba estreita sai o emblema |
| jv_T4p3 (música) | Item **Apps** → jv_T4p3 · `←→` playlists · `↑↓` músicas · `Enter`/duplo clique toca · `Espaço` toca/pausa · `n` próxima · `b` anterior · `,` `.` ±10 s · `-` `+` volume · `s` aleatório · `p` nova playlist · `a` campo de link · `Del` remove a música (suas playlists) · clicar na barra magenta busca o ponto. Fechar a janela não para a música: a barra superior mostra o que toca (clicar pausa) e os widgets **Fita** e **Mini player** controlam. Voz: ver *Widgets e apps por voz* · busca: "Tocar Flash FM", "pausar a música", "próxima música" |
| Núcleo | **Menu avançado → Núcleo**: **Holograma 3D** (padrão, WebGL), **Anéis 2D** (os anéis do holograma em vetor, girando e reagindo à voz, sem WebGL) ou **Desligado** (nada no centro, nem a captura de áudio do visual; a voz continua). Vale na hora · busca (`/`): "núcleo 2d", "núcleo desligado". Os fundos Grid e Matrix só existem no 3D. Medido no build de produção, parado em 1920×1080: processo de GPU ~370 MB no 3D, ~112 MB no 2D, ~100 MB desligado; CPU 52, 26 e 12 ms/s |
| Dock | **Menu avançado → Dock**: mostrar ou ocultar (desligada, os avisos continuam na base da tela; `M`, `/`, `Ctrl + ,` e a barra superior cobrem o que ela fazia) e ampliar ícones · busca (`/`): "ocultar a dock", "mostrar a dock" |
| Estilo das janelas | Menu avançado → Janelas: **TUI** (padrão: sem bordas, como apps de terminal num Sway; o nome do app em vídeo invertido, aceso na janela em foco — os widgets não mostram nome, só a barra para arrastar e o `×`; widgets desenhados como TUI: relógio estilo neofetch, pomodoro e bateria com barras `█░` e atalhos `[espaço] [r] [s] [-] [+]`, calculadora em REPL) ou **Holográfico** (painéis de vidro com brilho) |
| Editores | `Ctrl + S` salvar · `Ctrl + Shift + S` salvar como · `Ctrl + O` abrir · `Ctrl + N` novo · `Ctrl + F` buscar · Markdown: `Ctrl + B` negrito, `Ctrl + I` itálico, `Ctrl + K` link, `Ctrl + P` alterna editor/dividido/visualização |
| Ditar no Jarvis Mark | Segurar o microfone da toolbar do editor (ou `Espaço`/`Enter` com ele focado) e falar; soltar transcreve e insere no cursor. Enquanto está segurado, o assistente **não escuta** (nenhum modo reage), e a escuta volta ao normal ao soltar. Funciona mesmo com a escuta desligada: o motor sobe só para o ditado |
| Abrir um programa | Ícone na dock (o Terminal abre o jv_sh; o Windows Terminal externo fica na busca e nas Configurações) · voz · botão ▶ no painel |
| Mover a janela | Arrastar a faixa invisível no topo (28 px) |
| Maximizar/restaurar | Duplo clique na faixa do topo · `Win + ↑/↓` |
| Minimizar | `Ctrl + M` (a escuta continua) |
| Fechar | `Ctrl + Q` · `Alt + F4` |
| Tela cheia | `F11` |
| Moldura nativa (emergência) | `Ctrl + Shift + D` |
| Qualidade (low → medium → high) | `Ctrl + Shift + Q` |

O ponto sob o **Voice** indica o estado:

| Ponto | Estado |
|---|---|
| Apagado | Desligado |
| Piscando | Carregando o modelo |
| Fraco e fixo | Aguardando "Hey Jarvis" · pronto para segurar e falar |
| Pulsando | Ouvindo (inclusive enquanto o botão está segurado) |
| Vermelho | Erro ou aviso |

O tooltip descreve o estado.

## 9. Limitações conhecidas

- **Só Windows** foi configurado e testado: o lançador usa `cmd /C start` e o build pressupõe MSVC.
- **Vocabulário:** o Whisper transcreve qualquer fala, mas só palavras-chave cadastradas disparam ações. Nomes incomuns funcionam melhor com variantes (ex.: "claude" e "cloud code").
- **Modo "Sempre ouvindo":** qualquer conversa que contenha uma palavra-chave abre o programa. Prefira palavras que você não diz por acaso.
- **CPU:** cada frase ocupa a CPU por ~1 s (modelo Base). O modelo Small é mais preciso e cerca de 3× mais lento.
- **Microfone real:** a cadeia completa foi validada com áudio de fala real nos testes Rust. A captação acústica pelo microfone do notebook depende do hardware: se ele estiver mudo por tecla, o app avisa.
- **Permissão do WebView:** o microfone da camada visual é liberado no nível do WebView (`on_permission_request`). Se um "Bloquear" antigo tiver sido salvo, apague `%LOCALAPPDATA%\dev.jarvis.os\EBWebView`.
- **Licenças:** os modelos ggml vêm do repositório do whisper.cpp no Hugging Face (MIT).
- **Bateria:** o widget usa a Battery Status API do WebView. Um desktop sem bateria aparece como "Na tomada"; se a API não existir, "Indisponível neste ambiente".
- **Editores no navegador** (`npm run dev:web`): só rascunhos; abrir e salvar arquivos de verdade, e o ditado por voz, precisam do app desktop.
- **Ditado:** usa o mesmo modelo Whisper do assistente, com a janela de 30 s por trecho segurado; fale em trechos e solte. A pontuação vem do modelo (um prompt pontuado ajuda, mas não garante).
