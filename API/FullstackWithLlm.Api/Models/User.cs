namespace FullstackWithLlm.Api.Models;

public sealed class User
{
    public int Id { get; set; }
    public int CampusId { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Phone { get; set; } = "";
    public bool LivesOnCampus { get; set; }
    public DateTime MoveDate { get; set; }
    public DateTime? MoveOutDate { get; set; }
    public string? DormBuilding { get; set; }
    public char? SuiteLetter { get; set; }
}
