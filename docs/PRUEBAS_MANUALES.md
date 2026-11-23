# Pruebas manuales en dispositivo

Lista de comprobación para ejecutar en un emulador o dispositivo **Android** e **iOS**
(development build, `npm run android` / `npm run ios`). Cubre lo que los tests
automáticos (`npm test`) **no pueden verificar**: módulos nativos, gestos, cámara,
rendimiento, teclado, rotación, red real y backend.

Los tests automáticos sí cubren: todo el SQL de la app contra SQLite real, los
servicios de escritura, las reglas de solo lectura, el aislamiento entre técnicos y
los flujos de pantallas principales con datos demo. Esta guía empieza donde ellos
terminan.

## Cómo usar esta guía

- **Prioridad**: **P1** = bloquea la entrega si falla · **P2** = importante ·
  **P3** = pulido.
- Marca cada paso `[x]` al comprobarlo. Anota dispositivo, versión del sistema y
  fecha en la tabla final.
- Si un resultado no coincide, anota los pasos exactos, captura de pantalla y,
  si es posible, el log (`adb logcat` / consola de Xcode, filtrando por `[TEINS`).
- Ejecuta la guía completa al menos en: un Android de gama media (Android 12 o
  superior), un iPhone reciente, y una tablet (Android o iPad).

---

## 1. Arranque y apertura de la base — P1

1. [ ] Instala la app desde cero y ábrela. **Esperado**: pantalla de arranque y luego el
       login en menos de 3 s, sin pantallas en blanco ni cierres.
2. [ ] Sin `.env` completo (build de prueba con una variable vacía). **Esperado**: la
       pantalla de arranque avisa de la configuración incompleta y nombra la variable.
3. [ ] Inicia sesión (o entra en modo demo). **Esperado**: "Preparando tus datos..." y
       luego el dashboard; la base local se abre sin red.
4. [ ] Cierra la app por completo y ábrela de nuevo con sesión guardada. **Esperado**:
       entra directamente al dashboard, sin pasar por el login y sin esperar a la red.
5. [ ] Repite el paso 4 en modo avión. **Esperado**: igual que el paso 4.

## 2. Modo demo completo — P1

1. [ ] En el login, pulsa "Continuar en modo demo". **Esperado**: dashboard con
       2 asignadas, 1 en progreso, 0 completadas; la visita "VT-00002" aparece en progreso.
2. [ ] Recorre todas las secciones de una visita demo (formulario, materiales, fotos,
       anotaciones, resumen) creando datos en cada una. **Esperado**: todo se guarda y el
       resumen lo refleja.
3. [ ] Crea una visita nueva, iníciala y finalízala. **Esperado**: pasa por Asignada →
       En progreso → Completada y queda en solo lectura.
4. [ ] Comprueba el indicador de sincronización. **Esperado**: indica modo demo, nunca
       "sincronizando"; ninguna foto intenta subirse.
5. [ ] Sal del modo demo (icono de salir → "Salir"). **Esperado**: aviso de que se borran
       los datos de ejemplo; vuelve al login.
6. [ ] Entra de nuevo en modo demo. **Esperado**: solo están los 3 datos de ejemplo
       originales; lo creado en el paso 2 y 3 ya no existe.

## 3. Login real — P1 (requiere backend)

1. [ ] Contraseña incorrecta. **Esperado**: "Correo o contraseña incorrectos."
2. [ ] Correo no confirmado (si el backend lo permite). **Esperado**: mensaje de correo
       sin confirmar.
3. [ ] Login en modo avión. **Esperado**: "No hay conexión a Internet. Necesitas conexión
       para iniciar sesión."
4. [ ] Login correcto. **Esperado**: dashboard con el nombre del técnico y sus visitas
       reales tras la primera sincronización.
5. [ ] Varios intentos fallidos seguidos. **Esperado**: mensaje de demasiados intentos
       (si el servidor lo limita), nunca un error técnico en inglés.

## 4. Dashboard — P2

1. [ ] Comprueba los conteos con las visitas reales. **Esperado**: coinciden con el listado.
2. [ ] Desliza hacia abajo para refrescar. **Esperado**: el indicador aparece y desaparece.
3. [ ] Inicia una visita desde su detalle y vuelve. **Esperado**: los conteos y "En
       progreso" se actualizan solos.
4. [ ] Saludo y fecha. **Esperado**: "Buenos días/tardes/noches" según la hora local y la
       fecha en español.

## 5. Listado de visitas — P2

1. [ ] Cambia entre las pestañas. **Esperado**: cada una filtra correctamente; el mensaje
       vacío es el de la pestaña.
2. [ ] Busca por título, cliente, dirección, tipo ("energía") y con acentos y mayúsculas
       ("ÉXITO"). **Esperado**: resultados correctos tras una breve pausa al escribir.
3. [ ] Con más de 20 visitas, desplázate al final. **Esperado**: carga la siguiente página
       sin saltos ni duplicados.
4. [ ] "Nueva visita": deja el título vacío y pulsa crear. **Esperado**: error en el campo.
       Completa y crea. **Esperado**: abre el detalle de la visita nueva.

## 6. Cada sección de la visita — P1

### 6.1 Detalle

1. [ ] "Iniciar visita". **Esperado**: el estado cambia al instante a "En progreso".
2. [ ] "Finalizar visita" → confirmar. **Esperado**: estado "Completada", aviso de solo
       lectura y ninguna sección permite editar.

### 6.2 Formulario técnico

1. [ ] Elige plantilla (la recomendada aparece primero). **Esperado**: abre el formulario.
2. [ ] Escribe en varios campos y espera 1 s. **Esperado**: indicador "Guardado".
3. [ ] Pulsa "Completar formulario" con obligatorios vacíos. **Esperado**: salta a la
       primera sección con errores y los marca.
4. [ ] Completa y confirma. **Esperado**: queda en solo lectura; el resumen dice
       "Completado · <plantilla>".

### 6.3 Materiales

1. [ ] Agrega un material buscándolo por código y por nombre con acentos. **Esperado**:
       aparece en la lista con su unidad.
2. [ ] Intenta agregar el mismo material otra vez. **Esperado**: aparece como "Ya agregado".
3. [ ] Edita la cantidad (con coma decimal, p. ej. "12,5") y quita otro. **Esperado**:
       el resumen de totales se actualiza.

### 6.4 Fotografías

Ver la sección 7 y 8.

### 6.5 Planos

Ver la sección 9.

### 6.6 Resumen

1. [ ] Abre el resumen con datos en todas las secciones. **Esperado**: cada línea muestra
       su estado; pulsar una línea abre esa sección.

## 7. Cámara, galería, permisos y compresión — P1

1. [ ] Primera foto con la cámara. **Esperado**: el sistema pide permiso de cámara en ese
       momento (no al abrir la app).
2. [ ] Deniega el permiso. **Esperado**: aviso con "Abrir configuración", que abre los
       ajustes de la app.
3. [ ] Concede el permiso y toma la foto. **Esperado**: la miniatura aparece al instante
       con el punto de "en el dispositivo".
4. [ ] Elige una foto de la galería (denegando y luego concediendo el permiso).
       **Esperado**: igual que con la cámara.
5. [ ] Cancela la cámara y la galería. **Esperado**: no pasa nada ni aparece error.
6. [ ] Foto de alta resolución (≥ 12 MP). **Esperado**: se guarda; en el visor se ve nítida;
       el archivo pesa menos de 5 MB y mide como máximo 1920×1080 (comprobar con
       `adb shell ls -l` en `files/teins_photos` o en el contenedor de iOS).
7. [ ] Foto en vertical y en horizontal. **Esperado**: orientación correcta (sin rotar).
8. [ ] Elimina una foto no subida. **Esperado**: desaparece; la app no se cierra.

## 8. Visor de fotos — P1

1. [ ] Abre una foto. **Esperado**: pantalla completa, contador "1 / N", pie con el estado.
2. [ ] Desliza a izquierda y derecha. **Esperado**: cambia de foto y el contador se actualiza.
3. [ ] Pellizca para ampliar y desplaza la imagen ampliada. **Esperado**: zoom fluido hasta
       ~4×, sin salirse de los bordes; mientras está ampliada no cambia de foto.
4. [ ] Doble toque. **Esperado**: amplía; otro doble toque vuelve al tamaño normal.
5. [ ] Amplía una foto y desliza a la siguiente tras reducir. **Esperado**: la anterior
       vuelve sin zoom.
6. [ ] Botón eliminar desde el visor (visita abierta). **Esperado**: confirma y elimina.
       En una visita cerrada el botón no aparece.
7. [ ] Botón atrás de Android con el visor abierto. **Esperado**: cierra el visor.
8. [ ] Foto ya subida y borrada del dispositivo (con backend). **Esperado**: se descarga con
       URL firmada; sin conexión muestra "La fotografía no está disponible sin conexión."

## 9. Planos — P1

Requiere la migración `20261122000100_planos_y_figuras.sql` aplicada y la config de sync
desplegada (ver `docs/BACKEND.md`, paso 8).

**Varios planos por visita**

1. [ ] En "Planos", toca "Nuevo plano" sin nombre y otro con nombre "Planta baja".
       **Esperado**: aparecen "Plano 1" y "Planta baja" con su miniatura; cada uno se abre
       en su propio editor.
2. [ ] Renombra y elimina un plano (confirmando). **Esperado**: la lista se actualiza; al
       sincronizar, el cambio llega al servidor.
3. [ ] Resumen de la visita. **Esperado**: "2 planos · N elementos".
4. [ ] Visita con un plano dibujado con la versión anterior de la app. **Esperado**: se ve
       igual que antes y, al dibujar, se sigue guardando sin perder nada.

**Zoom y formato de plano**

5. [ ] Pellizca para acercar y alejar mucho (de centímetros a cientos de metros) y arrastra
       con dos dedos. **Esperado**: fluido; la cuadrícula se adapta; los trazos mantienen su
       grosor en pantalla; la barra de escala cambia (p. ej. "50 cm", "10 m").
6. [ ] Botones acercar, alejar y "Ver todo el plano". **Esperado**: encuadra todo el contenido.
7. [ ] Herramienta "Mover vista": arrastrar con un dedo mueve el plano sin dibujar.
8. [ ] Línea, flecha y cota con el ajuste activo. **Esperado**: los puntos caen en la
       cuadrícula, los ángulos van de 15 en 15° y arriba aparece la medida ("2,35 m"). La cota
       deja la medida escrita sobre la línea. Sin ajuste, el trazo sigue al dedo.
9. [ ] Cada herramienta: lápiz, línea, flecha, rectángulo, círculo, cota, texto y marcador,
       con distintos colores y grosores. Borrador sobre un elemento: solo se borra ese.
10. [ ] Empieza un trazo y apoya un segundo dedo. **Esperado**: el trazo se descarta y empieza
        el pellizco.
11. [ ] Deshacer y rehacer varias veces. **Esperado**: en orden; un cambio nuevo vacía
        "Rehacer".
12. [ ] Gira la pantalla. **Esperado**: no se pierde ni se deforma nada.
13. [ ] Sal y vuelve a entrar. **Esperado**: el plano se conserva (autoguardado).
14. [ ] Visita cerrada. **Esperado**: lista y editor de solo lectura; se puede hacer zoom y
        mover la vista con un dedo.

**Selección y figuras**

15. [ ] Herramienta "Seleccionar": toca un elemento y arrástralo; arrastra en vacío para
        seleccionar varios. **Esperado**: recuadro azul; se mueven juntos (con ajuste, a pasos
        de la cuadrícula). Duplicar, borrar y quitar la selección funcionan.
16. [ ] Selecciona varios elementos → "Guardar como figura" → nombre. **Esperado**: aviso
        "Figura guardada".
17. [ ] En otra visita, "Figuras guardadas" → toca la figura. **Esperado**: aparece en el
        centro de la pantalla, a su tamaño real y seleccionada para moverla.
18. [ ] Con otro dispositivo del mismo técnico (tras sincronizar). **Esperado**: la figura
        también está. Eliminarla no cambia los planos donde ya se usó.

## 10. Teclado sobre formularios y diálogos (Android) — P2

1. [ ] Login en un teléfono pequeño. **Esperado**: el teclado no tapa el campo activo ni el
       botón; "Siguiente" pasa a la contraseña y "Listo" envía.
2. [ ] Diálogo "Nueva visita" con el teclado abierto en la descripción. **Esperado**: el
       campo y los botones siguen visibles o se pueden alcanzar desplazando.
3. [ ] "Agregar material" (hoja inferior) al escribir la cantidad. **Esperado**: la hoja sube
       con el teclado.
4. [ ] Formulario técnico con campos al final de la sección. **Esperado**: el campo enfocado
       queda visible.

## 11. Selectores de fecha y hora — P2

1. [ ] Campo de fecha en Android. **Esperado**: abre el selector nativo; al aceptar se ve la
       fecha en formato español; al cancelar no cambia.
2. [ ] Campo de hora en Android (formato 24 h según el sistema).
3. [ ] Los mismos campos en iOS. **Esperado**: selector nativo de iOS, valores correctos.
4. [ ] Borrar una fecha opcional. **Esperado**: queda vacía.

## 12. Horizontal y tablet — P2

1. [ ] Gira cada pantalla a horizontal. **Esperado**: nada se corta; el detalle y el resumen
       pasan a dos columnas en pantallas anchas.
2. [ ] Tablet: login centrado con ancho máximo; listados con ancho limitado.
3. [ ] Respeta las zonas seguras (muesca, barra de navegación por gestos) en todas las
       pantallas y en el visor de fotos.

## 13. Sin conexión (modo avión) — P1

1. [ ] Activa el modo avión con la app abierta. **Esperado**: aparece el banner "Sin
       conexión" en segundos.
2. [ ] Trabaja una visita completa sin conexión (crear, iniciar, formulario, materiales,
       fotos, anotación, finalizar). **Esperado**: todo funciona igual; nada bloquea.
3. [ ] Desactiva el modo avión. **Esperado**: el banner desaparece; con backend, el
       indicador pasa a "sincronizando" y luego a sincronizado; las fotos se suben.
4. [ ] Corta la red a mitad de la subida de fotos. **Esperado**: las fotos vuelven a la cola
       sin error; se suben al recuperar la red.

## 14. Cerrar la app a mitad de edición — P1

1. [ ] Escribe en el formulario y cierra la app (deslizar desde recientes) antes de 1 s.
       **Esperado**: al reabrir, lo escrito está guardado (o como mucho falta el último
       carácter).
2. [ ] Igual en anotaciones, justo después de dibujar.
3. [ ] Cierra la app mientras sube una foto. **Esperado**: al reabrir, la foto vuelve a la
       cola y se sube.
4. [ ] Envía la app a segundo plano 10 minutos y vuelve. **Esperado**: sigue donde estaba,
       sesión activa.

## 15. Pantalla de error global — P2

1. [ ] Con un build de desarrollo, provoca un error de renderizado (p. ej. temporalmente
       en una pantalla). **Esperado**: se muestra la pantalla de error en español con opción
       de reintentar, no una pantalla roja ni un cierre.
2. [ ] Abre una ruta inexistente (enlace profundo). **Esperado**: pantalla "no encontrado"
       con vuelta al inicio.

## 16. Con backend: sincronización — P1

1. [ ] Primera sincronización tras el login. **Esperado**: llegan las visitas asignadas, el
       catálogo de materiales y las plantillas.
2. [ ] Cambia una visita en el servidor. **Esperado**: el cambio aparece en la app sin
       reiniciar.
3. [ ] Haz cambios sin conexión y reconecta. **Esperado**: llegan al servidor; el contador
       de pendientes vuelve a 0.
4. [ ] Provoca un rechazo del servidor (p. ej. un dato que viola una restricción).
       **Esperado**: la tarjeta de sincronización indica cambios rechazados; el resto de la
       cola sigue subiendo.
5. [ ] Cierra sesión con cambios pendientes. **Esperado**: aviso con el número de cambios;
       al volver a entrar con la misma cuenta se suben.
6. [ ] Inicia sesión con OTRA cuenta en el mismo dispositivo. **Esperado**: no se ve ningún
       dato del técnico anterior.

## 17. Con backend: subida de fotos — P1

1. [ ] Toma una foto con conexión. **Esperado**: pasa de "en el dispositivo" a "subida" en
       segundos; el objeto existe en el bucket `visit-photos` en `visits/<visita>/photos/<foto>.jpg`.
2. [ ] Error del servidor (p. ej. bucket sin permiso). **Esperado**: estado "error de
       subida" y reintento automático cada minuto.

## 18. Con backend: sesión expirada — P1

1. [ ] Revoca la sesión desde el panel de Supabase (o espera a que caduque el token de
       refresco). **Esperado**: la app vuelve al login con "Tu sesión ha expirado. Por favor
       inicia sesión nuevamente." y conserva los cambios locales pendientes.
2. [ ] Deja la app en segundo plano más de 1 h y vuelve con red. **Esperado**: el token se
       renueva solo; la sincronización sigue sin pedir login.

## 19. Con backend: dos dispositivos con el mismo usuario — P2

1. [ ] Inicia sesión con el mismo técnico en dos dispositivos.
2. [ ] Edita la misma visita en ambos (formulario y materiales) sin conexión y reconecta
       los dos. **Esperado**: ambos convergen al mismo estado; ningún cambio se pierde sin
       quedar registrado como incidencia.
3. [ ] Finaliza la visita en uno. **Esperado**: el otro la muestra como completada y en
       solo lectura tras sincronizar.

---

## 20. Marca de fecha y ubicación en las fotos — P1

Requisitos: backend migrado (docs/BACKEND.md, 2.2) si se prueba con sincronización.

1. [ ] Primera foto con la cámara en una visita en curso. **Esperado**: tras el permiso de
       cámara, el sistema pide la ubicación con el texto en español «mientras usas la app»
       (Android: «Mientras la app está en uso»; nunca «Permitir todo el tiempo»).
2. [ ] Acepta, al aire libre. **Esperado**: la foto guardada lleva abajo una franja oscura
       semitransparente con la fecha y hora local (`18/11/2026 14:35:07`), las coordenadas
       con 6 decimales y la precisión (`-3.993421, -79.204512 ±8 m`) y el título de la
       visita. Se lee bien sobre una foto clara (pared blanca, cielo) y sobre una oscura.
3. [ ] Compara las coordenadas con Google Maps (mantén pulsado el punto): coinciden con
       unos metros de diferencia. Gira el teléfono: en vertical y horizontal la letra es
       proporcional y la franja no tapa más de ~20 % de la foto.
4. [ ] Visita con un título muy largo: se recorta con «…» sin salirse de la imagen.
5. [ ] Abre la foto en el visor. **Esperado**: el pie muestra la misma fecha y las
       coordenadas (o «Ubicación no disponible»).
6. [ ] Deniega la ubicación (o quítala en Ajustes) y toma otra foto. **Esperado**: se
       guarda igual, con «Ubicación no disponible», sin errores.
7. [ ] Activa el GPS en interiores / sin señal (modo avión con GPS activo). **Esperado**: la
       foto se guarda como máximo ~8 s después, con ubicación o con «Ubicación no
       disponible». Una segunda foto antes de 2 minutos sale sin espera (última posición).
8. [ ] Sin Internet: la marca se dibuja igual (no hace falta red; no hay dirección escrita).
9. [ ] Elige de la galería una foto antigua tomada con la cámara del teléfono.
       **Esperado**: fecha y hora de la foto (no la actual). Ubicación: la de la foto si el
       sistema la entrega; si no, «Ubicación no disponible» (nunca la posición actual).
       _Nota_: en Android 10+ el sistema suele quitar la ubicación de las fotos de galería
       (la app no pide `ACCESS_MEDIA_LOCATION`), así que lo normal es «Ubicación no
       disponible».
10. [ ] Una foto de galería sin fecha (captura de pantalla). **Esperado**: fecha actual.
11. [ ] Tamaño: una foto de 12 MP ocupa menos de 5 MB y mide como máximo 1920×1080 / 1080×1920.
12. [ ] Con backend: en _Table Editor → photos_ la fila tiene `latitude`, `longitude`,
        `location_accuracy` y `taken_at`; en Storage la imagen subida lleva la marca.
13. [ ] Tiempo de guardado: anota cuánto tarda desde que se toca «Aceptar» en la cámara hasta
        que aparece la miniatura en un Android de gama media (objetivo: < 3 s con GPS reciente).

## 21. Materiales personalizados — P1

1. [ ] Materiales → Agregar material. **Esperado**: se ve el botón «Agregar material que no
       está en el catálogo» (también si el catálogo no cargó).
2. [ ] Ábrelo: nombre, unidad (Unidad, Metro, Kilogramo, Litro, Caja, Rollo, Par, Juego,
       Global, Otra), cantidad y observaciones. Pulsa «Agregar» vacío: aparecen los errores
       en español.
3. [ ] Elige «Otra (escribirla)»: aparece «Escribe la unidad» (máx. 20). La cantidad muestra
       esa unidad al lado.
4. [ ] Agrega «Abrazadera especial», 2,5 caja. **Esperado**: en la lista aparece con la
       marca «Personalizado» (sin código) y el resumen dice «Incluye 1 personalizado».
5. [ ] Intenta agregar « abrazadera ESPECIAL » en caja otra vez. **Esperado**: mensaje
       «Ya agregaste un material personalizado con ese nombre y esa unidad…». En metro sí
       se acepta. Un material del catálogo con el mismo nombre también.
6. [ ] Edita la cantidad y quita el personalizado: funcionan como los del catálogo.
7. [ ] Resumen de la visita: «N materiales · 1 personalizado · …».
8. [ ] Con backend: en _visit_materials_ la fila tiene `material_id` NULL, `is_custom` true y
       `material_code` `PERSONALIZADO`; el catálogo (`material_catalog`) no cambió. En otro
       dispositivo del mismo técnico aparece con la marca «Personalizado».

## 22. Varios formularios en la misma visita — P1

1. [ ] Detalle de visita → Formulario técnico. **Esperado**: pantalla «Formularios técnicos»
       con «Sin formularios» y el botón «Agregar formulario».
2. [ ] Agregar formulario: las plantillas del tipo de visita salen primero («Recomendado»).
       Elige una, llena la mitad y vuelve atrás. **Esperado**: la lista muestra la plantilla,
       «En curso» y «x de y campos obligatorios».
3. [ ] Agrega un segundo formulario con otra plantilla. **Esperado**: la plantilla ya usada no
       se ofrece. Vuelve al primero: conserva lo escrito.
4. [ ] Cambia rápido entre formularios y cierra la app a mitad (sección 14). **Esperado**:
       nada se pierde.
5. [ ] Completa uno: queda «Completado» y de solo lectura; el otro sigue editable.
6. [ ] Resumen de la visita: «2 formularios · 1 completado». «Finalizar visita» no exige
       formularios. Con la visita finalizada la lista es de solo lectura y no hay botón para
       agregar.
7. [ ] Visita que ya tenía un formulario antes de esta versión: aparece en la lista con su
       plantilla y se puede seguir llenando.
8. [ ] Con backend: _form_responses_ tiene una fila por formulario con `template_key`; la
       visita conserva en `form_template_id` la plantilla del **primer** formulario.

## 23. Informe PDF de la visita — P1

Requiere un build con `expo-print` y `expo-sharing` (ver docs/COMPILACION.md §9).

1. [ ] Visita con dos formularios (uno completado), materiales del catálogo y uno
       personalizado, 3 fotos con marca y un plano con líneas, texto, marcador y cota.
       Detalle → **Compartir PDF**. **Esperado**: el botón pasa a «Generando PDF...»,
       queda inactivo y se abre la hoja de compartir del sistema con
       `Visita_<cliente>_<AAAA-MM-DD>.pdf`.
2. [ ] Ábrelo (Drive, visor de PDF). **Esperado**: tamaño A4; cabecera con el logo TEINS
       y «Generado el …»; datos de la visita (cliente, tipo, dirección, estado, técnico,
       fechas, coordenadas, observaciones); cada formulario con sus secciones y respuestas
       (Sí/No, fechas largas, números con coma y unidad, selección múltiple separada por
       comas, «Sin respuesta» en los vacíos); tabla de materiales con «personalizado»;
       fotos con su marca impresa, pie y número; el plano dibujado igual que en la
       miniatura de la app.
3. [ ] Ninguna fila de tabla, foto ni plano queda cortada entre dos páginas.
4. [ ] Números de página «Página N de M» abajo a la derecha. **Nota**: dependen del motor
       de impresión (Android System WebView reciente sí; en iOS pueden no aparecer). Si no
       salen, anótalo pero no es un fallo.
5. [ ] En **modo avión**: el PDF se genera igual (todo sale del dispositivo) y se puede
       guardar en «Archivos»/descargas.
6. [ ] Compártelo por WhatsApp y por correo. **Esperado**: llega como documento PDF con el
       nombre descriptivo. Tamaño razonable (con 10 fotos, del orden de 1–3 MB).
7. [ ] Foto cuyo archivo ya no está en el teléfono (p. ej. visita descargada de otro
       dispositivo): en su lugar aparece «La fotografía no está guardada en este
       dispositivo…», el resto del informe sale bien.
8. [ ] Visita con más de 40 fotos: se incluyen las 40 más recientes y una nota indica
       cuántas se omitieron.
9. [ ] Título, cliente u observaciones con `<b>`, `&` o comillas: se imprimen tal cual
       (no cambian el formato).
10. [ ] Cancelar la hoja de compartir no muestra error; el botón vuelve a «Compartir PDF».
11. [ ] Visita finalizada (solo lectura): el botón sigue disponible.
12. [ ] iPad: la hoja de compartir se abre sin cerrarse la app.

## 24. Inventario de bodega — P1 (requiere backend)

Antes: migración `20261122000200_inventario.sql` aplicada y `powersync/sync-config.yaml`
desplegado (docs/BACKEND.md §2.4). Usuarios: un técnico, uno de oficina y un admin. En el
_Table Editor_ (o con el admin desde la app, paso 6) pon `min_stock = 100` a «Cable UTP
Cat6» y deja otro material sin mínimo.

1. [ ] Técnico: Inicio → **Inventario**. **Esperado**: lista de materiales activos con
       código, nombre y existencias («N metro»); el aviso «Consulta de existencias…»; arriba,
       los que están **bajo mínimo** con la marca «Bajo mínimo». Las existencias coinciden
       con `material_stock.on_hand` del servidor.
2. [ ] «Qué comprar» lista solo los materiales bajo mínimo con «Comprar N … (hay X; mínimo
       Y)», con N = mínimo − existencias redondeado hacia arriba. Sin ninguno bajo mínimo:
       «Nada por comprar…».
3. [ ] Busca por código y por nombre (con y sin tildes) y marca «Solo bajo mínimo».
4. [ ] Toca un material: detalle con En bodega, Compras, Ajustes, Usado en visitas, Mínimo e
       historial. El técnico **no** ve «Registrar compra», «Ajuste» ni «Mínimo».
5. [ ] Oficina: detalle → **Registrar compra**, 50, nota «Factura 1». **Esperado**: vuelve
       al detalle, el movimiento aparece con «Pendiente de sincronizar» y las existencias
       **no cambian todavía**. Con conexión, en segundos: la marca desaparece y «En bodega»
       sube 50 (también en el teléfono del técnico).
6. [ ] Oficina: **Ajuste** con «0» → error; con «-3» → se guarda y, al sincronizar, baja 3.
       Admin: **Mínimo** → 12 → el material entra o sale de «Qué comprar». Oficina no ve
       «Mínimo».
7. [ ] Técnico: en una visita agrega 10 m de un material del catálogo y un material
       personalizado. Inventario: el material del catálogo aparece «Pendiente de
       sincronizar»; al sincronizar, «Usado en visitas» sube 10 y «En bodega» baja 10. El
       personalizado no aparece en el inventario. Cambia la cantidad a 4 y después quita el
       material: las existencias se ajustan cada vez (tras sincronizar).
8. [ ] **Modo avión** (oficina): registra una compra. **Esperado**: se guarda, aviso de
       cambios sin enviar; al volver la conexión se sube sola y las existencias se
       actualizan.
9. [ ] Seguridad: con la sesión de un técnico, inserta un movimiento por la API REST de
       Supabase. **Esperado**: lo rechaza la RLS (42501) y `material_stock` no cambia. (Si
       llegara a subirlo la app, quedaría en el aviso de cambios rechazados del inicio.)
10. [ ] Dos técnicos usan el mismo material en sus visitas: las existencias que ven todos
        (también oficina) descuentan el uso de **ambos**.

## 25. Asistente (chatbot) — P1

Datos: inventario con un material bajo mínimo (sección 24), visitas de dos clientes y una
visita con materiales hoy. El asistente con Claude requiere la función `assistant`
desplegada y los secretos de docs/BACKEND.md §11.

**Asistente básico (gratis, sin IA)**

1. [ ] Inicio → **Asistente**. **Esperado**: mensaje de bienvenida y sugerencias; bajo el
       título, «Asistente básico · sin IA» si la función no está activada.
2. [ ] Toca «¿Qué tengo que comprar?». **Esperado**: la misma lista y cantidades que «Qué
       comprar» del inventario, con coma decimal y unidad, y el botón «Abrir inventario» (abre
       la pantalla de inventario).
3. [ ] Escribe «cuanto cabel queda» (con error) y «¿Cuánto CABLE me queda?». **Esperado**:
       las existencias y el mínimo del cable, iguales a las del inventario.
4. [ ] «consumo de hoy», «cuánto cable usé este mes», «consumo del 1 al 15 de noviembre».
       **Esperado**: cantidades que coinciden con los materiales de esas visitas (sin los
       personalizados).
5. [ ] «visitas pendientes», «visitas de hoy», «visitas en curso», «visitas de <cliente>»
       (sin tildes). **Esperado**: solo tus visitas, con su estado.
6. [ ] «PDF de la visita de <cliente con una sola visita>». **Esperado**: tarjeta con
       «Compartir PDF»; al tocarla pasa a «Generando PDF...» y se abre la hoja de compartir con
       el mismo PDF que el botón de la visita.
7. [ ] «informe de <cliente con varias visitas>». **Esperado**: chips con cada visita; al
       tocar una aparece su tarjeta «Compartir PDF».
8. [ ] «¿Cómo tomo una foto?», «¿cómo registro una compra?» (con técnico y con oficina).
       **Esperado**: pasos numerados que coinciden con la app y la nota del rol.
9. [ ] «xyz» y «hola». **Esperado**: «No entendí…» con sugerencias; el saludo lista lo que
       puede hacer.
10. [ ] **Modo avión** con la función activada: pregunta algo. **Esperado**: aviso
        «Respondiendo sin conexión con el asistente básico.» y la respuesta del básico. El
        PDF también se genera sin conexión.
11. [ ] Modo demo: funciona con los datos de ejemplo (siempre el básico).

**Asistente con Claude (función activada)**

12. [ ] Con `ANTHROPIC_API_KEY` y `ASSISTANT_MODEL=claude-haiku-5-5`, repite 2 a 8 con
        frases libres («¿me alcanza el cable para dos visitas más?»). **Esperado**: bajo la
        respuesta, «Asistente con IA (Claude)»; los datos coinciden con el inventario y las
        visitas (nada inventado).
13. [ ] Oficina o administración: «visitas pendientes de todos los técnicos». **Esperado**:
        incluye visitas de otros técnicos con su nombre. Un técnico solo ve las suyas.
14. [ ] Oficina: «PDF de una visita de otro técnico». **Esperado**: aparece la tarjeta
        «Compartir PDF» (oficina y administración tienen todas las visitas en el teléfono).
        Un técnico que lo pida para una visita ajena recibe la explicación, sin tarjeta.
15. [ ] Pregunta ajena a TEINS («escribe un poema»). **Esperado**: responde que solo ayuda
        con la app.
16. [ ] Clave no válida o sin saldo en Anthropic. **Esperado**: aviso «El asistente con IA no
        respondió…» y respuesta del básico; nada se rompe.
17. [ ] Cambia `ASSISTANT_MODEL` a `claude-opus-5-5` sin reinstalar la app. **Esperado**: la
        siguiente pregunta la responde Opus (en los logs de la función).
18. [ ] Cierra sesión y vuelve a entrar. **Esperado**: la conversación anterior ya no está.
19. [ ] «¿Cuánto cable usé en la visita de <cliente>?», «materiales de la última visita» y
        «¿En qué visitas se usó cable?» (con y sin conexión). **Esperado**: cantidades por
        visita iguales a las de la pantalla Materiales; ningún material «sin conteo inicial»
        aparece con un número negativo como existencia.

---

## 26. Falta conteo inicial y uso por visita — P1 (requiere backend)

1. [ ] Material del catálogo usado en visitas pero sin compras ni ajustes. **Esperado**: en
       Inventario dice «Falta conteo inicial» (no «-63 metro») y «Usado en visitas: 63
       metro». No está en «Qué comprar»: aparece en el grupo «Sin conteo inicial».
2. [ ] Como oficina, abre ese material. **Esperado**: «Registra un ajuste con lo que hay en
       bodega.»; como técnico, el aviso de que oficina debe registrar el conteo.
3. [ ] Oficina registra un ajuste (p. ej. +80) y sincroniza. **Esperado**: ya muestra el
       número (80 − usado). Si queda negativo: «Stock negativo: revisa el conteo».
4. [ ] En el detalle, toca «Uso por visita». **Esperado**: total arriba y una fila por
       visita (cliente/título, fecha, estado y cantidad), la más reciente primero; tocar una
       fila abre la visita.

## 27. Administración y oficina ven todas las visitas — P1 (requiere backend)

Antes: redesplegar `powersync/sync-config.yaml` (docs/BACKEND.md, 2.5).

1. [ ] Entra como oficina. **Esperado**: el inicio dice «Visitas de todos los técnicos…» y
       cuenta todas; la lista se llama «Visitas» y cada visita ajena dice «Técnico: <nombre>».
2. [ ] Abre una visita de otro técnico. **Esperado**: «Visita de <técnico>: puedes
       consultarla, pero solo su técnico puede editarla.»; sin «Iniciar/Finalizar visita»;
       formularios, materiales, fotos y planos en solo lectura; «Compartir PDF» funciona.
3. [ ] Como técnico. **Esperado**: igual que antes, solo sus visitas.
4. [ ] Cambia el rol de un usuario de oficina a técnico en Supabase y sincroniza.
       **Esperado**: las visitas ajenas desaparecen del teléfono.
5. [ ] Asistente (sin conexión) como oficina: «materiales de la visita de <cliente de otro
       técnico>». **Esperado**: lista sus materiales.

---

## Registro de ejecución

| Fecha | Dispositivo | Sistema | Build | Secciones | Resultado | Notas |
| ----- | ----------- | ------- | ----- | --------- | --------- | ----- |
|       |             |         |       |           |           |       |
