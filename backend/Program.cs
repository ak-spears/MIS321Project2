using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();
builder.Services.AddControllers();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();

var frontendPath = Path.Combine(Directory.GetCurrentDirectory(), "..", "frontend");
if (Directory.Exists(frontendPath))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath)
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath)
    });
}

app.Run();
