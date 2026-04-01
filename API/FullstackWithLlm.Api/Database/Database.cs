namespace api.database;

/// <summary>Optional holder for connection parts (not wired into DI). Runtime uses ConnectionStrings:DefaultConnection from .env.
/// </summary>
public class Database
{
    public string host { get; set; } = "";
    public string port { get; set; } = "";
    public string database { get; set; } = "";
    public string username { get; set; } = "";
    public string password { get; set; } = "";
    public string connectionString { get; set; } = "";

    public Database(string connectionString)
    {
        host = "etdq12exrvdjisg6.cbetxkdyhwsb.us-east-1.rds.amazonaws.com";
        port = "3306";
        database = "oxpfu8qzrafbs7xg";
        username = "mav4hp12ntuls641";
        password = "wi7xwkxkr2jhrg0s";
        connectionString =
            $"Server={host};Port={port};Database={database};User Id={username};Password={password};SslMode=Required;";
    }
}
