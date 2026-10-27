# O que é IA

**Inteligência artificial** é o campo que faz computadores realizarem tarefas que, em pessoas, chamaríamos de inteligentes: reconhecer uma imagem, entender um pedido, traduzir um texto, decidir o próximo passo de um plano.

## Regras × aprendizado

Há dois jeitos de ensinar um computador a separar spam de e-mail normal:

| | Programação tradicional | Aprendizado de máquina (ML) |
|---|---|---|
| Quem define o comportamento | Uma pessoa escreve as regras | O modelo descobre padrões nos dados |
| Entrada | Regras + dados → respostas | Dados + respostas → regras (o modelo) |
| Quando o mundo muda | Alguém reescreve as regras | Treina de novo com dados novos |

Regras escritas à mão funcionam até alguém escrever `gr4tis` no lugar de `grátis`. Um modelo treinado com muitos exemplos aprende padrões mais gerais do que qualquer lista de palavras.

## As camadas da IA

- **IA**: o campo inteiro, incluindo sistemas de regras.
- **Machine learning**: sistemas que *aprendem* com dados em vez de seguir regras fixas.
- **Deep learning**: ML com redes neurais de muitas camadas; é o que move visão, voz e linguagem hoje.
- **IA generativa**: modelos que *criam* conteúdo novo (texto, imagem, áudio, código). Os LLMs estão aqui.

Cada camada está contida na anterior.

## Treino e inferência

1. **Dados rotulados**: exemplos com a resposta certa (“isto é spam”, “isto não é”). Isso se chama *aprendizado supervisionado*.
2. **Treino**: o modelo começa chutando. A cada passada pelos dados (uma **época**) mede o erro (a **loss**) e ajusta seus **parâmetros**, os pesos, para errar menos.
3. **Inferência**: com os pesos fixos, o modelo é usado em dados novos, que nunca viu.

> Um LLM moderno tem bilhões de parâmetros e treina em trilhões de palavras. O nosso filtro de spam tem 13. A ideia é a mesma.

## No laboratório

Você vai ver o filtro por regras falhar com uma mensagem disfarçada, olhar o dataset, treinar o modelo e usá-lo nessa mesma mensagem.
