<?php
declare(strict_types=1);

/**
 * OPÉRATION — réception des avis des visiteurs.
 *
 * Les messages sont stockés dans un fichier JSONL HORS de la racine web
 * (/var/www/default/data en production), jamais affichés publiquement.
 * Aucune adresse IP en clair n'est conservée : seule une empreinte tronquée
 * sert à limiter les envois.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function repondre(int $code, array $donnees): void
{
    http_response_code($code);
    echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function champ(string $nom, int $max = 2000): string
{
    $valeur = $_POST[$nom] ?? '';
    if (!is_string($valeur)) {
        return '';
    }
    $valeur = trim($valeur);
    return strlen($valeur) > $max ? substr($valeur, 0, $max) : $valeur;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    repondre(405, ['ok' => false, 'erreur' => 'Méthode non autorisée.']);
}

// Champ caché : les robots le remplissent, les humains ne le voient pas.
if (champ('site', 100) !== '') {
    repondre(200, ['ok' => true]);
}

$pseudo  = champ('pseudo', 40);
$message = champ('message', 1200);
$sujet   = champ('sujet', 20);
$version = champ('version', 40);
$ecran   = champ('ecran', 40);

$note = filter_var($_POST['note'] ?? 0, FILTER_VALIDATE_INT);
$note = ($note === false || $note < 0 || $note > 5) ? 0 : $note;

$sujets = ['', 'munitions', 'difficulte', 'commandes', 'performance', 'bug', 'autre'];
if (!in_array($sujet, $sujets, true)) {
    $sujet = 'autre';
}

$longueur = function_exists('mb_strlen') ? 'mb_strlen' : 'strlen';
if ($longueur($message) < 10) {
    repondre(422, ['ok' => false, 'erreur' => 'Le message est trop court (10 caractères minimum).']);
}
if ($longueur($message) > 1200) {
    repondre(422, ['ok' => false, 'erreur' => 'Le message est trop long (1200 caractères maximum).']);
}

// En production : /var/www/default/data. En test local, OPERATION_DATA_DIR
// permet de pointer vers un dossier de staging.
$dossier = getenv('OPERATION_DATA_DIR') ?: dirname(__DIR__, 3) . '/data';
if (!is_dir($dossier) && !@mkdir($dossier, 0770, true) && !is_dir($dossier)) {
    error_log('OPÉRATION commentaires : dossier de données indisponible');
    repondre(500, ['ok' => false, 'erreur' => 'Le service de messages est momentanément indisponible.']);
}
if (!is_writable($dossier)) {
    error_log('OPÉRATION commentaires : dossier non inscriptible : ' . $dossier);
    repondre(500, ['ok' => false, 'erreur' => 'Le service de messages est momentanément indisponible.']);
}

// Limitation simple : un message toutes les 30 s par adresse (IP hachée).
$adresse = (string)($_SERVER['REMOTE_ADDR'] ?? '');
$cleAdresse = hash('sha256', 'operation|' . $adresse);
$fichierLimites = $dossier . '/commentaires-operation-limites.json';
$maintenant = time();
$limites = [];
if (is_readable($fichierLimites)) {
    $brut = @file_get_contents($fichierLimites);
    $decode = $brut !== false ? json_decode($brut, true) : null;
    if (is_array($decode)) {
        $limites = $decode;
    }
}
foreach ($limites as $cle => $moment) {
    if (!is_int($moment) || $maintenant - $moment > 3600) {
        unset($limites[$cle]);
    }
}
if (isset($limites[$cleAdresse]) && $maintenant - (int)$limites[$cleAdresse] < 30) {
    repondre(429, ['ok' => false, 'erreur' => 'Patiente une trentaine de secondes avant un nouvel envoi.']);
}
$limites[$cleAdresse] = $maintenant;
@file_put_contents($fichierLimites, json_encode($limites), LOCK_EX);

$entree = [
    'date' => date('c'),
    'pseudo' => $pseudo,
    'sujet' => $sujet,
    'note' => $note,
    'message' => $message,
    'version' => $version,
    'ecran' => $ecran,
    'navigateur' => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 220),
    'ip' => substr($cleAdresse, 0, 16),
];
$ligne = json_encode($entree, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($ligne === false) {
    repondre(500, ['ok' => false, 'erreur' => 'Le message n’a pas pu être enregistré.']);
}

$fichier = $dossier . '/commentaires-operation.jsonl';
if (@file_put_contents($fichier, $ligne . "\n", FILE_APPEND | LOCK_EX) === false) {
    error_log('OPÉRATION commentaires : écriture impossible dans ' . $fichier);
    repondre(500, ['ok' => false, 'erreur' => 'Le message n’a pas pu être enregistré.']);
}

repondre(200, ['ok' => true]);
