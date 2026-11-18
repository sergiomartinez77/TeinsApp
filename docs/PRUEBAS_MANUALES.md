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

### 6.5 Anotaciones

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

## 9. Lienzo de anotaciones — P1

1. [ ] Cada herramienta: trazo libre, línea, flecha, rectángulo, círculo, texto y marcador.
       **Esperado**: se dibuja donde está el dedo, con el color y grosor elegidos.
2. [ ] Texto: escribe, confirma y cancela. **Esperado**: el texto aparece donde se tocó.
3. [ ] Borrador: toca un elemento. **Esperado**: se borra solo ese elemento.
4. [ ] Deshacer varias veces (hasta 20). **Esperado**: deshace en orden; el botón se
       desactiva cuando no queda nada.
5. [ ] Gira la pantalla con dibujos hechos. **Esperado**: los elementos conservan su posición
       y proporción relativas; nada se deforma ni se pierde.
6. [ ] Dibuja trazos largos y rápidos durante 30 s. **Esperado**: fluido (sin tirones
       visibles), sin retraso entre el dedo y el trazo.
7. [ ] Sal y vuelve a entrar. **Esperado**: la anotación se conserva (autoguardado).
8. [ ] En una visita cerrada. **Esperado**: solo lectura, sin herramientas.

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

---

## Registro de ejecución

| Fecha | Dispositivo | Sistema | Build | Secciones | Resultado | Notas |
| ----- | ----------- | ------- | ----- | --------- | --------- | ----- |
|       |             |         |       |           |           |       |
