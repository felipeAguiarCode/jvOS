# LLM por dentro

Um **LLM** (*large language model*) é uma rede neural, quase sempre um **Transformer**, treinada com uma tarefa simples em escala enorme: **prever o próximo token**.

## Tokens

O modelo não lê letras nem palavras: lê **tokens**, pedaços de texto com um número cada.

- Palavras frequentes costumam ser um token só (` mundo`).
- Palavras raras, acentos e emojis viram vários tokens (`Ol` + `á`).
- Em inglês, um token tem em média uns 4 caracteres. Em português costuma ter menos, então o mesmo texto gasta mais tokens.

Preço, limite de contexto e velocidade são medidos em tokens.

## Prever o próximo token

Dado o texto até aqui, o modelo dá uma probabilidade a **cada token do vocabulário** para vir em seguida:

```
"O céu é"  →   azul 0,66 · lindo 0,12 · o 0,07 · …
```

Gerar uma resposta é repetir isto: escolher um token, colocá-lo no fim do texto e prever de novo.

O pré-treino ensina a língua e o mundo. Um treino posterior, com instruções e preferências humanas, ensina o modelo a ser um assistente útil.

## Temperatura

A **temperatura** muda como o próximo token é escolhido:

| Temperatura | Efeito | Bom para |
|---|---|---|
| 0 | sempre o mais provável; quase determinístico | extração, código, respostas exatas |
| ~1 | sorteia seguindo as probabilidades do modelo | conversa, escrita |
| > 1 | achata a distribuição; entram escolhas improváveis | brainstorm (com cuidado) |

## Janela de contexto

A cada chamada o modelo recebe **tudo de novo**: instruções, ferramentas, a conversa e sua mensagem. Isso tudo precisa caber na **janela de contexto**, de milhares a centenas de milhares de tokens conforme o modelo.

O modelo não guarda memória entre chamadas. Se a conversa passa do limite, alguém precisa cortar ou resumir.

## No laboratório

Você vai tokenizar um texto, ver as probabilidades do próximo token, gerar com temperatura 0 e 1,5 e olhar o que ocupa a janela de contexto.
