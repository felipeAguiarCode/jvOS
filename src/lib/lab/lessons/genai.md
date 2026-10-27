# IA generativa

Um classificador responde *qual destes rótulos?*. Um modelo generativo responde *como seria um exemplo novo disto?*.

## Discriminativo × generativo

- **Discriminativo** aprende a fronteira entre classes: dado um texto, a chance de ele ser positivo, negativo ou neutro. Só escolhe entre opções que já existem.
- **Generativo** aprende a **distribuição** dos próprios dados: como textos, imagens ou sons costumam ser. Com isso consegue **amostrar** exemplos novos, que não estavam no treino.

## Amostragem: por que a resposta muda

Gerar é sortear. A cada passo o modelo calcula a probabilidade de cada continuação e sorteia uma. Por isso:

- o mesmo prompt pode dar respostas diferentes;
- uma **seed** (semente do sorteio) fixa torna o resultado reprodutível, o que ajuda em testes e comparações;
- a **temperatura** controla o quanto o sorteio arrisca. Você vai vê-la na lição de LLMs.

## Modalidades

| Modalidade | Exemplos de uso |
|---|---|
| Texto e código | assistentes, resumos, agentes de programação |
| Imagem | ilustração, edição, design |
| Áudio | voz sintética, música |
| Vídeo | clipes curtos a partir de texto |

Os geradores de imagem mais comuns são **modelos de difusão**. Eles partem de ruído puro e, passo a passo, removem um pouco do ruído na direção do que o prompt descreve.

## Cuidado: alucinação

Um modelo generativo produz o que é *plausível*, não necessariamente o que é *verdadeiro*. Uma resposta fluente e confiante pode ter fatos inventados. Por isso se usam fontes, ferramentas e verificação.

## No laboratório

Você vai comparar um classificador com um gerador, ver o mesmo prompt dar textos diferentes, fixar a seed e ver uma imagem nascer do ruído.
