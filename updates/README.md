# updates/

Acá van los pedidos de cambios para Young. El bot toma cualquier `.txt` o `.pdf`
de esta carpeta (normalmente `updates.txt`).

## Camino corto (desde Young Live)

1. Pedile al Oráculo lo que querés cambiar — por ejemplo *"armame un updates.txt
   con mejoras para el editor"*. Lo escribe en **MyComputer → updates.txt**.
2. Abrí el panel **Updates** (ícono de la barra izquierda) y tocá
   **Enviar a GitHub**. Se abre GitHub con un archivo nuevo ya cargado
   (`updates/updates-AAAAMMDD-HHMM.txt`, solo con los pedidos que no mandaste).
3. Tocá **Commit changes**. El resto pasa solo:

```
updates.txt en main
  └─ updates-to-pr.yml   Claude implementa lo nuevo y abre un PR [updates-bot]
       └─ CodeRabbit     revisa el PR
            └─ coderabbit-feedback.yml   Claude aplica el review (máx. 2 rondas)
                 └─ vos   mergeás → Vercel deploya
```

## Camino manual

Descargá `updates.txt` o `updates.pdf` desde el panel **Updates** y subilo a esta
carpeta en GitHub (*Add file → Upload files*). Si se renombra solo
(`updates (2).txt`) no pasa nada.

## Formato

Un pedido concreto por línea:

```
[ ] Agregar botón para borrar todo el historial del chat
[ ] Mostrar la fecha en cada mensaje
```

El bot marca `[x]` lo que implementó y agrega `-> bot: ...` debajo de lo que salteó.
