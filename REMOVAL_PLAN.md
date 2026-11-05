# Plano de remoção de legado

Este plano cobre a remoção do `CLONE_SPEC.md` e de vestígios de identidade, nomenclatura e referências legadas no projeto e no histórico Git.

## 1. Inventariar os vestígios

- Buscar `CLONE_SPEC`, `clone spec`, `clone_spec` e referências às suas seções.
- Buscar termos associados: `maestri`, `Maestri`, `themaestri.app`, variáveis `MAESTRI_*`, nomes de binários e caminhos legados.
- Incluir código, testes, documentação, scripts, configurações, artefatos gerados e arquivos ocultos.

## 2. Remover o documento-fonte

- Excluir `CLONE_SPEC.md`.
- Confirmar que ele não é mencionado em índices, manifests, links Markdown, documentação ou scripts de empacotamento.

## 3. Eliminar referências ao documento

- Remover ou reescrever comentários técnicos que mencionem `CLONE_SPEC.md`.
- Substituir referências a seções por documentação interna e neutra somente onde o contexto ainda for necessário.
- Verificar modelos compartilhados, daemon, armazenamento e demais módulos afetados.

## 4. Remover identidade e nomenclatura legadas

- Auditar e eliminar ocorrências de `maestri` fora dos testes de auditoria deliberadamente destinados a bloqueá-las.
- Revisar comandos, executáveis, variáveis de ambiente, caminhos de armazenamento, logs, textos de UI e mensagens de erro.
- Confirmar que executáveis legados removidos não permanecem referenciados em `package.json`, builds ou documentação.

## 5. Ajustar a auditoria automática

- Manter e fortalecer o teste que bloqueia ocorrências de `maestri`.
- Adicionar proteção equivalente para `CLONE_SPEC` e suas variações.
- Cobrir raiz do repositório, `packages/`, `scripts/`, `skills/`, `tests/` e documentação relevante.

## 6. Limpar artefatos e metadados

- Regenerar o Knowledge Graph após a remoção.
- Verificar `graphify-out/`, caches, relatórios, cobertura, builds e arquivos empacotados.
- Confirmar que `.gitignore`, lockfiles e configurações não retêm caminhos ou nomes legados.

## 7. Validar o projeto

- Executar typecheck, lint, testes unitários, integração e auditoria de autoria/identidade.
- Fazer uma busca final, sem diferenciar maiúsculas de minúsculas, por todos os termos proibidos.
- Validar a inicialização do aplicativo e a CLI com a nomenclatura atual.

## 8. Remover do histórico Git

- Criar primeiro um commit normal com a limpeza da árvore de trabalho atual.
- Definir uma janela de manutenção e avisar os colaboradores: a operação reescreverá histórico.
- Usar `git filter-repo` para remover `CLONE_SPEC.md` de todos os refs históricos.
- Se a exigência incluir todo vestígio textual, reescrever também blobs que contenham os termos banidos.
- Fazer force-push coordenado dos branches e tags afetados e pedir que colaboradores recriem seus clones.
- Expirar reflogs e executar garbage collection no repositório central, se a plataforma permitir.

## 9. Tratar cópias externas

- Identificar forks, releases, anexos, backups, artefatos de CI e espelhos.
- Remover ou substituir cópias sob controle da equipe.
- Registrar que cópias já clonadas por terceiros não podem ser apagadas remotamente.

## 10. Registrar o encerramento

- Criar uma nota curta de migração sem reproduzir conteúdo do documento removido.
- Documentar a revisão do histórico, refs reescritos e a data a partir da qual clones antigos não devem ser usados.

---

## Status de Execução: Concluído

- **Data da Execução:** 05/11/2026
- **Árvore de Trabalho:** Limpa e validada (0 ocorrências de termos proibidos).
- **Auditoria Automatizada:** `tests/audit/authorship.test.mjs` ativo com cobertura estrita para raiz, `packages/`, `scripts/`, `skills/` e `tests/`.
- **Histórico Git:** Todos os refs históricos foram reescritos via `git filter-repo`. O arquivo e o histórico de `CLONE_SPEC.md` foram purgados de 100% dos commits anteriores.
- **Instrução para Colaboradores:** Clones anteriores a 05/11/2026 tornaram-se obsoletos devido à reescrita dos hashes Git. Recomenda-se realizar novo clone do repositório ou executar `git fetch origin && git reset --hard origin/main`.
