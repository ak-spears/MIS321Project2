using System;
using System.IO;

namespace FullstackWithLlm.Api;

public static class EnvLoader
{
    // Minimal `.env` loader for local dev.
    // It supports: KEY=VALUE, optional surrounding quotes, and ignores blank lines/comments.
    // Heroku does NOT use this file; it uses real environment variables/config vars.
    public static void LoadLocalEnv(string filePath)
    {
        if (!File.Exists(filePath))
        {
            return;
        }

        foreach (var rawLine in File.ReadAllLines(filePath))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith("#"))
            {
                continue;
            }

            var equalsIndex = line.IndexOf('=');
            if (equalsIndex <= 0)
            {
                continue;
            }

            var key = line.Substring(0, equalsIndex).Trim();
            var value = line.Substring(equalsIndex + 1).Trim();

            // Strip surrounding quotes: "value" or 'value'
            if ((value.StartsWith("\"") && value.EndsWith("\"")) ||
                (value.StartsWith("'") && value.EndsWith("'")))
            {
                value = value.Substring(1, value.Length - 2);
            }

            if (key.Length == 0)
            {
                continue;
            }

            // Don't override real environment variables.
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }
    }

    public static void LoadLocalEnvFromUpwards(string envFileName = ".env", int maxLevels = 10)
    {
        // Works even when the process working directory is not the project folder
        // (Heroku uses a different working dir, and `Procfile` runs from repo root).
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < maxLevels && !string.IsNullOrWhiteSpace(dir); i++)
        {
            var candidatePath = Path.Combine(dir, envFileName);
            if (File.Exists(candidatePath))
            {
                LoadLocalEnv(candidatePath);
                return;
            }

            var parent = Directory.GetParent(dir);
            dir = parent?.FullName ?? string.Empty;
        }
    }
}

