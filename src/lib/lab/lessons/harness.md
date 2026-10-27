# Harness

O modelo sozinho só faz uma coisa: recebe texto e devolve texto. Para virar um **agente**, que lê arquivos, roda comandos e corrige um bug sozinho, ele precisa de um **harness**: o software em volta que conecta o modelo ao mundo.

> O modelo é o motor. O harness é o resto do carro: volante, freio, painel e cinto.

Assistentes de programação em linha de comando, IDEs com agente e SDKs de agente são harnesses. Com o mesmo modelo, harnesses diferentes podem dar resultados bem diferentes.

## As peças

- **Instruções (system prompt)**: quem o agente é, como deve trabalhar, as regras do projeto.
- **Ferramentas**: funções que o modelo pode *pedir*, como `read_file`, `edit_file`, `run` e `search`. Cada uma é descrita com nome, explicação e parâmetros.
- **Loop agêntico**: chama o modelo; se ele pede uma ferramenta, executa e devolve o resultado; repete até ele responder sem pedir nada.
- **Permissões**: o que roda livre, o que pergunta antes e o que é proibido. Modos como *plan* (só leitura) mudam isso.
- **Contexto**: decide o que entra em cada chamada e **compacta** (resume) a conversa quando ela se aproxima do limite.
- **Hooks**: código que o harness roda em eventos, como formatar depois de editar ou bloquear um comando perigoso. É determinístico: não depende do modelo lembrar.
- **Memória e subagentes**: arquivos de instruções recarregados a cada sessão, e agentes auxiliares com o próprio contexto.

## O loop, passo a passo

```
você → [harness] → modelo
modelo → tool_use: run {"command": "npm test"}
harness → (permissão?) → executa → resultado → modelo
modelo → tool_use: edit_file …
…
modelo → resposta final (sem tool_use) → fim
```

O modelo **nunca executa nada**: só pede, em JSON. Quem executa, e quem pode negar, é o harness.

## Por que isso importa

- **Segurança**: permissões e modos de só leitura ficam fora do modelo.
- **Qualidade**: boas ferramentas e boas instruções valem tanto quanto um modelo melhor.
- **Custo e contexto**: cada turno reenvia o histórico, então o harness precisa ser econômico.

## No laboratório

Você vai ver as peças, listar as ferramentas, acompanhar o loop corrigindo um teste, repetir no modo plan e ver o contexto ser compactado.
