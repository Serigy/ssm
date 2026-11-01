#!/usr/bin/env python3
"""
Grava ids de D1 e KV no bloco de ambiente certo de cada wrangler.jsonc.

Feito com substituição textual em vez de parse porque o arquivo é JSONC: tem
comentários, e eles são metade do valor do arquivo. Um parser JSON os descarta,
e reescrever o arquivo a partir do objeto apagaria a explicação de por que cada
binding existe.

A substituição é escopada ao bloco do ambiente. Os blocos aparecem em ordem —
dev no topo, depois "hmg", depois "prd" — então achar o marcador do ambiente e
trabalhar dali até o próximo delimita a região com segurança.

  cf-ids.py hmg financial --d1 abc123 --kv def456
"""
import argparse
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def fatia(texto: str, ambiente: str) -> tuple[int, int]:
    """Início e fim do bloco daquele ambiente."""
    marca = re.search(rf'"{ambiente}"\s*:\s*{{', texto)
    if not marca:
        raise SystemExit(f'bloco "{ambiente}" não encontrado')
    inicio = marca.end()
    # O próximo ambiente delimita; se não houver, vai até o fim.
    seguinte = re.search(r'"(hmg|prd)"\s*:\s*{', texto[inicio:])
    fim = inicio + seguinte.start() if seguinte else len(texto)
    return inicio, fim


def troca(texto: str, ambiente: str, campo: str, valor: str) -> tuple[str, bool]:
    inicio, fim = fatia(texto, ambiente)
    bloco = texto[inicio:fim]
    padrao = re.compile(rf'("{campo}"\s*:\s*")(PLACEHOLDER|[0-9a-f]{{32}}|local-[a-z]+)(")')
    novo, n = padrao.subn(rf'\g<1>{valor}\g<3>', bloco, count=1)
    if n == 0:
        return texto, False
    return texto[:inicio] + novo + texto[fim:], True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('ambiente', choices=['hmg', 'prd'])
    ap.add_argument('worker')
    ap.add_argument('--d1')
    ap.add_argument('--kv')
    args = ap.parse_args()

    caminho = RAIZ / 'workers' / args.worker / 'wrangler.jsonc'
    if not caminho.exists():
        print(f'  {args.worker:12} sem wrangler.jsonc', file=sys.stderr)
        return 1

    texto = caminho.read_text()
    feitos = []
    if args.d1:
        texto, ok = troca(texto, args.ambiente, 'database_id', args.d1)
        feitos.append(f'd1={"ok" if ok else "não encontrou"}')
    if args.kv:
        texto, ok = troca(texto, args.ambiente, 'id', args.kv)
        feitos.append(f'kv={"ok" if ok else "não encontrou"}')

    caminho.write_text(texto)
    print(f'  {args.worker:12} {args.ambiente}  {"  ".join(feitos)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
