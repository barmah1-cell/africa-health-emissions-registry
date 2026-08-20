-- Remove WHO-imported duplicates that overlap with our manually added Cederberg clinics
-- Keep the manually added ones (which have city populated and correct ownership)
DELETE FROM facility 
WHERE name_text IN ('Citrusdal Clinic', 'Clanwilliam Clinic', 'Graafwater Clinic', 'Lamberts Bay Clinic', 'Elands Bay Clinic', 'Wupperthal Clinic')
AND country = 'South Africa'
AND city IS NULL;

-- Verify what remains
SELECT name_text, city, ownership, facility_type, verification_status 
FROM facility 
WHERE (name_text LIKE '%Citrusdal%' OR name_text LIKE '%Clanwilliam%' OR name_text LIKE '%Graafwater%' OR name_text LIKE '%Lamberts%' OR name_text LIKE '%Elands Bay%' OR name_text LIKE '%Wupperthal%') 
AND country = 'South Africa' AND deleted_at IS NULL 
ORDER BY name_text;
