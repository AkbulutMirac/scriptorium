## Scriptorium işçileri (DeepSeek ve local LLM'ler)

`mcp__scriptorium__*` araçları varsa (Scriptorium açıkken her Claude Code oturumunda olur), Claude kullanım limitini korumak için uygun işleri işçilere devret. Ne zaman devredeceğine sen karar verirsin; sormana gerek yok.

**Devret:**
- Net tanımlı, kendi içinde kapalı kod işleri: tek fonksiyon, script, test, tip/şema, kod dönüştürme, regex, SQL.
- Büyük girdi alıp küçük çıktı veren işler: uzun log ya da belge özeti, sınıflandırma, veri çıkarma, çeviri.
- Birbirinden bağımsız birkaç iş: aynı mesajda birden fazla `ask_worker` çağrısıyla paralel ver.

**Devretme:**
- Projenin geneline bakmayı gerektiren debug, mimari kararlar, güvenlik incelemesi.
- Kendin birkaç satırda daha hızlı yapacağın işler.

**Nasıl:**
1. Emin değilsen `list_workers` ile kimin hazır ve boşta olduğuna bak.
2. Varsayılan `deepseek` (hızlı, ucuz). Zor algoritma ya da uzun kod için `deepseek-pro`.
3. Gizli veri (şifre, anahtar, `.env`, kişisel ya da müşteri verisi) varsa `sensitive: true` ver ve local işçi seç. Local işçi yoksa devretme.
4. Görevi tek başına anlaşılır yaz: dil, beklenen çıktı biçimi, kısıtlar. Gereken dosyaları `files` ile ver, `project_dir` olarak çalışma klasörünün tam yolunu yaz.
5. Birkaç dakikadan uzun işler (özellikle local modelle) için `start_job`, sonra `job_status`.
6. Gelen cevabı kontrol etmeden kullanma: kodu kendin dosyaya yaz ve çalıştır ya da test et. Yanlışsa düzelt ya da hatayla birlikte işçiye geri ver.
7. Kullanıcıya hangi işi hangi işçiye verdiğini tek satırla söyle.

Kullanıcı bir işçiyi adıyla isterse onu kullan. "İşçi kullanma" derse o oturumda devretme.
